import unittest

from backend.models.schemas import Annotation, Mutation
from backend.services.aligner import annotate_mutations
from backend.services.parser import parse_sequence_file


class ParserAlignerTests(unittest.TestCase):
    def test_parse_fasta_file(self):
        fasta = b">seq1\nATGCGC\n"
        records = parse_sequence_file(fasta, "sample.fasta")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].id, "seq1")
        self.assertEqual(records[0].length, 6)
        self.assertEqual(records[0].format, "fasta")

    def test_annotate_mutations(self):
        mutations = [Mutation(position=5, ref="A", alt="T", type="SNP")]
        annotations = [Annotation(chrom="chr", start=1, end=10, name="geneA")]
        updated = annotate_mutations(mutations, annotations)
        self.assertEqual(updated[0].in_feature, "geneA")


if __name__ == "__main__":
    unittest.main()
