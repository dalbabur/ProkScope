from __future__ import annotations

import json
import logging
import os

import regex
from pydantic import BaseModel

from backend.models.schemas import Annotation

logger = logging.getLogger(__name__)

_COMPLEMENT = str.maketrans("ACGTacgt", "TGCAtgca")


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
