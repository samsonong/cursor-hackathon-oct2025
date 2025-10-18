export type QuickFact = {
  label: string;
  value: string;
  category?: string;
  notes?: string;
};

export type KnowledgeBlock = {
  title: string;
  summary: string;
  bullets?: string[];
  tags?: string[];
  relatedLinks?: string[];
  lastVerified?: string;
};

export type FaqEntry = {
  question: string;
  answer: string;
  relatedTopics?: string[];
};

export interface ChangiJewelKnowledge {
  overview: KnowledgeBlock;
  quickFacts: QuickFact[];
  history: KnowledgeBlock[];
  developmentPartnership: KnowledgeBlock[];
  architectureAndEngineering: KnowledgeBlock[];
  natureAndBiophilia: KnowledgeBlock[];
  attractionsAndExperiences: KnowledgeBlock[];
  canopyParkHighlights: KnowledgeBlock[];
  artAndInstallations: KnowledgeBlock[];
  shoppingAndDining: KnowledgeBlock[];
  hospitalityAndServices: KnowledgeBlock[];
  operationsAndLogistics: KnowledgeBlock[];
  visitorPlanning: KnowledgeBlock[];
  sustainabilityAndInnovation: KnowledgeBlock[];
  awardsAndRecognition: KnowledgeBlock[];
  futureOutlook: KnowledgeBlock[];
  triviaAndFunFacts: string[];
  faqs: FaqEntry[];
  references: string[];
}
