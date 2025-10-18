export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
};

export type VoiceConfig = {
  id: string;
  settings: VoiceSettings;
};

export const VOICE_CONFIG: Record<string, VoiceConfig> = {
  "Cheryl Tan": {
    id: "7qdeg0yn0d1SFxiXCaQz",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.2,
      speed: 0.9,
    },
  },
  "A Weijie": {
    id: "MYMTXuR5f6wasost8ELu",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.0,
      speed: 1.0,
    },
  },
  "Sir Raffles": {
    id: "UVG279at0tA3kx8YMpY9",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.2,
      speed: 0.95,
    },
  },
  "The OG Founder Utama": {
    id: "jwgqT6RTmzByLL2GerTR",
    settings: {
      stability: 0.3,
      similarityBoost: 0.75,
      style: 0.3,
      speed: 1.2,
    },
  },
  "Jake": {
    id: "BHyvQU4czkhWdOZH4Rdq",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.0,
      speed: 1.1,
    },
  },
  "Lilian": {
    id: "6qpxBH5KUSDb40bij36w",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.0,
      speed: 1.2,
    },
  },
};
