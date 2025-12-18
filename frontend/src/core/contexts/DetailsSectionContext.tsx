import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface DetailsSectionState {
  overview: boolean;
  containers: boolean;
  utilization: boolean;
  data: boolean;
  nodePods?: boolean;
}

interface DetailsSectionContextType {
  sectionStates: DetailsSectionState;
  setSectionExpanded: (section: keyof DetailsSectionState, expanded: boolean) => void;
}

const DetailsSectionContext = createContext<DetailsSectionContextType | undefined>(undefined);

export const useDetailsSectionContext = () => {
  const context = useContext(DetailsSectionContext);
  if (!context) {
    throw new Error('useDetailsSectionContext must be used within DetailsSectionProvider');
  }
  return context;
};

interface DetailsSectionProviderProps {
  children: ReactNode;
}

export const DetailsSectionProvider: React.FC<DetailsSectionProviderProps> = ({ children }) => {
  const [sectionStates, setSectionStates] = useState<DetailsSectionState>({
    overview: true,
    containers: true,
    utilization: true,
    data: true,
    nodePods: true,
  });

  const setSectionExpanded = (section: keyof DetailsSectionState, expanded: boolean) => {
    setSectionStates((prev) => ({
      ...prev,
      [section]: expanded,
    }));
  };

  return (
    <DetailsSectionContext.Provider value={{ sectionStates, setSectionExpanded }}>
      {children}
    </DetailsSectionContext.Provider>
  );
};
