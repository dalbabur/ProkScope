import { create } from 'zustand';
import type { Annotation, BatchComparisonResult, ComparisonResult, SequenceRecord } from '../types';

type State = {
  sequences: SequenceRecord[];
  referenceId: string | null;
  annotations: Annotation[];
  comparisonResult: ComparisonResult | BatchComparisonResult | null;
  driveSessionToken: string | null;
  isLoading: boolean;
  error: string | null;
  hiddenFeatureTypes: string[];
  setSequences: (sequences: SequenceRecord[] | ((prev: SequenceRecord[]) => SequenceRecord[])) => void;
  setReferenceId: (id: string | null) => void;
  setAnnotations: (annotations: Annotation[] | ((prev: Annotation[]) => Annotation[])) => void;
  setComparisonResult: (result: ComparisonResult | BatchComparisonResult | null) => void;
  setDriveSessionToken: (token: string | null) => void;
  setIsLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  toggleFeatureType: (featureType: string) => void;
};

export const useStore = create<State>((set) => ({
  sequences: [],
  referenceId: null,
  annotations: [],
  comparisonResult: null,
  driveSessionToken: null,
  isLoading: false,
  error: null,
  hiddenFeatureTypes: [],
  setSequences: (sequences) =>
    set((state) => ({
      sequences: typeof sequences === 'function' ? sequences(state.sequences) : sequences
    })),
  setReferenceId: (referenceId) => set({ referenceId }),
  setAnnotations: (annotations) =>
    set((state) => ({
      annotations: typeof annotations === 'function' ? annotations(state.annotations) : annotations
    })),
  setComparisonResult: (comparisonResult) => set({ comparisonResult }),
  setDriveSessionToken: (driveSessionToken) => set({ driveSessionToken }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  toggleFeatureType: (featureType) =>
    set((state) => ({
      hiddenFeatureTypes: state.hiddenFeatureTypes.includes(featureType)
        ? state.hiddenFeatureTypes.filter((item) => item !== featureType)
        : [...state.hiddenFeatureTypes, featureType]
    }))
}));
