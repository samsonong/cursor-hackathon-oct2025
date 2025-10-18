"use server";

import OpenAI from "openai";

let cachedOpenAI: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (cachedOpenAI) {
    return cachedOpenAI;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for image analysis with OpenAI."
    );
  }

  cachedOpenAI = new OpenAI({ apiKey });
  return cachedOpenAI;
}

export interface ImageAnalysisRequest {
  imageDataUrl: string;
  userQuestion?: string;
  placeName?: string;
  language?: string;
}

export interface ImageAnalysisResponse {
  analysis: string;
  detectedObjects?: string[];
  tourGuideResponse: string;
  error?: string;
}

export async function analyzeImageAction(
  request: ImageAnalysisRequest
): Promise<ImageAnalysisResponse> {
  try {
    const {
      imageDataUrl,
      userQuestion,
      placeName = "Changi Jewel",
      language = "en-SG",
    } = request;

    if (!imageDataUrl) {
      throw new Error("Image data URL is required for analysis.");
    }

    const openai = getOpenAIClient();

    console.info("[OpenAI][ImageAnalysis] starting", {
      placeName,
      hasQuestion: Boolean(userQuestion),
      language,
    });

    // Extract base64 data from data URL
    const base64Data = imageDataUrl.split(",")[1];
    if (!base64Data) {
      throw new Error("Invalid image data URL format.");
    }

    // Create the system prompt for tour guide context
    const systemPrompt = `You are an AI tour guide for Changi Jewel Airport. Analyze images and provide:

1. Brief description (2-3 sentences max)
2. Key landmarks or features visible
3. One interesting fact if relevant
4. Answer user questions concisely

Keep responses under 50 words. Be engaging but concise.
Location: ${placeName}
Language: ${language}`;

    const userPrompt = userQuestion 
      ? `Analyze this image and answer briefly: "${userQuestion}"`
      : "Briefly describe what you see in this image (max 50 words).";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 100,
      temperature: 0.7,
    });

    const analysis = response.choices[0]?.message?.content;
    if (!analysis) {
      throw new Error("No analysis received from OpenAI.");
    }

    // Try to extract detected objects/features (simple keyword extraction)
    const detectedObjects = extractDetectedObjects(analysis);

    return {
      analysis,
      detectedObjects,
      tourGuideResponse: analysis,
    };
  } catch (error) {
    console.error("Image analysis error:", error);
    return {
      analysis: "Unable to analyze the image at this time.",
      tourGuideResponse:
        "I'm sorry, I couldn't analyze your image. Please try again or ask me about Changi Jewel in another way.",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

function extractDetectedObjects(analysis: string): string[] {
  // Simple keyword extraction for common Changi Jewel features
  const keywords = [
    "rain vortex",
    "waterfall",
    "canopy park",
    "garden",
    "shopping",
    "restaurant",
    "airport",
    "terminal",
    "departure",
    "arrival",
    "check-in",
    "security",
    "architecture",
    "glass",
    "steel",
    "modern",
    "contemporary",
    "design",
    "trees",
    "plants",
    "nature",
    "indoor",
    "outdoor",
    "bridge",
    "walkway",
    "escalator",
    "elevator",
    "stairs",
    "floor",
    "ceiling",
    "wall",
    "window",
  ];

  const detected = keywords.filter((keyword) =>
    analysis.toLowerCase().includes(keyword.toLowerCase())
  );

  return detected.length > 0 ? detected : ["general architecture"];
}
