from __future__ import annotations

import json
import logging
import os
from io import StringIO

import regex
from Bio import SeqIO
from pydantic import BaseModel

from backend.models.schemas import Annotation

logger = logging.getLogger(__name__)

_COMPLEMENT = str.maketrans("ACGTacgt", "TGCAtgca")


_LABEL_QUALIFIERS = ["label", "note", "gene", "product", "standard_name"]
_COLOR_QUALIFIERS = ["ApEinfo_fwdcolor", "ApEinfo_revcolor"]
_DESCRIPTION_QUALIFIERS = ["note", "product", "gene"]
_DEFAULT_EXCLUDE: set[str] = {"primer", "primer_bind"}
_DEFAULT_MIN_LENGTH = 6


class FeatureRecord(BaseModel):
    id: str
    label: str
    type: str
    length: int
    strand: str
    color: str
    sequence: str
    description: str
    source_plasmid: str
    source_file: str
    tags: list[str] = []


class FeatureDB:
    def __init__(self, path: str) -> None:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        self.features: list[FeatureRecord] = [FeatureRecord(**f) for f in data.get("features", [])]
        self._by_id: dict[str, FeatureRecord] = {f.id: f for f in self.features}
        self._by_type: dict[str, list[FeatureRecord]] = {}
        for feat in self.features:
            self._by_type.setdefault(feat.type, []).append(feat)

    @classmethod
    def from_features(cls, features: list[FeatureRecord]) -> "FeatureDB":
        """Create a FeatureDB from a pre-built list of FeatureRecords without a backing file."""
        instance = cls.__new__(cls)
        instance.features = features
        instance._by_id = {f.id: f for f in features}
        instance._by_type = {}
        for feat in features:
            instance._by_type.setdefault(feat.type, []).append(feat)
        return instance

    def search(self, query: str) -> list[FeatureRecord]:
        if not query:
            return list(self.features)
        q = query.lower()
        return [
            f for f in self.features
            if q in f.label.lower()
            or q in f.description.lower()
            or q in f.type.lower()
            or any(q in tag.lower() for tag in f.tags)
        ]

    def filter(
        self,
        types: list[str] | None = None,
        min_length: int | None = None,
        max_length: int | None = None,
        tags: list[str] | None = None,
    ) -> list[FeatureRecord]:
        result = self.features
        if types:
            types_lower = [t.lower() for t in types]
            result = [f for f in result if f.type.lower() in types_lower]
        if min_length is not None:
            result = [f for f in result if f.length >= min_length]
        if max_length is not None:
            result = [f for f in result if f.length <= max_length]
        if tags:
            tags_lower = [t.lower() for t in tags]
            result = [f for f in result if any(t.lower() in tags_lower for t in f.tags)]
        return result

    def find_in_genome(
        self,
        genome_seq: str,
        feature_ids: list[str] | None = None,
        max_mismatches: int = 0,
    ) -> list[Annotation]:
        candidates = (
            [self._by_id[fid] for fid in feature_ids if fid in self._by_id]
            if feature_ids is not None
            else self.features
        )

        genome_upper = genome_seq.upper()
        hits: list[Annotation] = []

        for feat in candidates:
            fwd_seq = feat.sequence.upper()
            rev_seq = self.reverse_complement(fwd_seq)

            for seq, strand in [(fwd_seq, "+"), (rev_seq, "-")]:
                if not seq:
                    continue
                if max_mismatches == 0:
                    start = 0
                    while True:
                        pos = genome_upper.find(seq, start)
                        if pos == -1:
                            break
                        hits.append(
                            Annotation(
                                chrom="genome",
                                start=pos,
                                end=pos + len(seq),
                                name=feat.label,
                                strand=strand,
                                feature_type=feat.type,
                                source=feat.source_plasmid,
                                score=None,
                                color=feat.color,
                            )
                        )
                        start = pos + 1
                else:
                    pattern = f"(?:{regex.escape(seq)}){{e<={max_mismatches}}}"
                    for m in regex.finditer(pattern, genome_upper, regex.IGNORECASE):
                        hits.append(
                            Annotation(
                                chrom="genome",
                                start=m.start(),
                                end=m.end(),
                                name=feat.label,
                                strand=strand,
                                feature_type=feat.type,
                                source=feat.source_plasmid,
                                score=None,
                                color=feat.color,
                            )
                        )

        hits.sort(key=lambda a: a.start)
        return hits

    @staticmethod
    def reverse_complement(seq: str) -> str:
        return seq.translate(_COMPLEMENT)[::-1]

    def update_tags(self, feature_id: str, tags: list[str]) -> FeatureRecord:
        if feature_id not in self._by_id:
            raise KeyError(f"Feature not found: {feature_id}")
        feat = self._by_id[feature_id]
        updated = feat.model_copy(update={"tags": tags})
        self._by_id[feature_id] = updated
        idx = next(i for i, f in enumerate(self.features) if f.id == feature_id)
        self.features[idx] = updated
        return updated


_db_path = os.getenv("FEATURE_DB_PATH", "feature_db.json")
db: FeatureDB | None = None


def get_db() -> FeatureDB:
    global db
    if db is None:
        if not os.path.exists(_db_path):
            raise FileNotFoundError(f"feature_db.json not found at {_db_path}")
        db = FeatureDB(_db_path)
    return db


def reload_db(new_path: str) -> FeatureDB:
    global db
    db = FeatureDB(new_path)
    return db


def set_db(instance: FeatureDB) -> FeatureDB:
    """Set the global DB to a pre-built FeatureDB instance."""
    global db
    db = instance
    return db


def _first_qualifier(qualifiers: dict, keys: list[str]) -> str | None:
    for key in keys:
        values = qualifiers.get(key)
        if values:
            v = values[0].strip() if isinstance(values, list) else str(values).strip()
            if v:
                return v
    return None


def build_db_from_genbank_bytes(
    files: list[tuple[str, bytes]],
    min_length: int = _DEFAULT_MIN_LENGTH,
    exclude_types: set[str] | None = None,
) -> FeatureDB:
    """Build a FeatureDB in-memory from a list of (filename, content) GenBank file pairs.

    Mirrors the logic in build_feature_db.py without requiring disk writes.
    """
    if exclude_types is None:
        exclude_types = _DEFAULT_EXCLUDE
    exclude_lower = {e.lower() for e in exclude_types}

    seen: dict[tuple[str, str], dict] = {}

    for filename, content_bytes in files:
        text = content_bytes.decode("utf-8", errors="ignore")
        try:
            records = list(SeqIO.parse(StringIO(text), "genbank"))
        except Exception as exc:
            logger.warning("Could not parse %s: %s", filename, exc)
            continue

        for record in records:
            record_seq = str(record.seq)
            plasmid_name = record.name or filename.rsplit(".", 1)[0]

            for feature in record.features:
                feat_type = feature.type
                if feat_type.lower() in exclude_lower:
                    continue

                loc = feature.location
                feat_seq = record_seq[loc.start:loc.end]
                if len(feat_seq) < min_length:
                    continue

                qualifiers = feature.qualifiers or {}
                label = _first_qualifier(qualifiers, _LABEL_QUALIFIERS)
                if label is None:
                    continue

                color = _first_qualifier(qualifiers, _COLOR_QUALIFIERS) or "#888888"

                desc_parts: list[str] = []
                for key in _DESCRIPTION_QUALIFIERS:
                    v = qualifiers.get(key)
                    if v:
                        val = v[0].strip() if isinstance(v, list) else str(v).strip()
                        if val and val != label:
                            desc_parts.append(val)
                description = "; ".join(dict.fromkeys(desc_parts))

                strand = "+" if (loc.strand is None or loc.strand >= 0) else "-"

                key = (label.lower(), feat_seq.upper())
                entry: dict = {
                    "label": label,
                    "type": feat_type,
                    "length": len(feat_seq),
                    "strand": strand,
                    "color": color,
                    "sequence": feat_seq,
                    "description": description,
                    "source_plasmid": plasmid_name,
                    "source_file": filename,
                    "tags": [],
                }
                existing = seen.get(key)
                if existing is None or len(description) > len(existing["description"]):
                    seen[key] = entry

    sorted_entries = sorted(seen.values(), key=lambda f: (f["source_file"], f["label"]))
    features = [
        FeatureRecord(id=f"feat_{i + 1:04d}", **entry)
        for i, entry in enumerate(sorted_entries)
    ]
    return FeatureDB.from_features(features)
