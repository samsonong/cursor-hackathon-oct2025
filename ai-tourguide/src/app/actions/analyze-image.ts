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
    const { imageDataUrl, userQuestion, placeName = "Changi Jewel", language = "en-SG" } = request;

    if (!imageDataUrl) {
      throw new Error("Image data URL is required for analysis.");
    }

    const openai = getOpenAIClient();

    // Extract base64 data from data URL
    const base64Data = imageDataUrl.split(',')[1];
    if (!base64Data) {
      throw new Error("Invalid image data URL format.");
    }

    // Create the system prompt for tour guide context
    const systemPrompt = `You are an AI tour guide specializing in Changi Jewel Airport. When analyzing images, provide:

1. A detailed description of what you see in the image
2. Identify any landmarks, architecture, or notable features
3. Provide interesting facts, history, or context about what's visible
4. If the image shows areas of Changi Jewel, give specific information about those locations
5. Answer any specific questions the user has about the image
6. Maintain an engaging, informative tour guide tone

Current location context: ${placeName}
Language: ${language}

Be conversational and educational, as if you're personally guiding someone through the location.`;

    const userPrompt = userQuestion 
      ? `Please analyze this image and answer: "${userQuestion}"`
      : "Please analyze this image and tell me what you see, with interesting details about any Changi Jewel features visible.";

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
      max_tokens: 1000,
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
      tourGuideResponse: "I'm sorry, I couldn't analyze your image. Please try again or ask me about Changi Jewel in another way.",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

function extractDetectedObjects(analysis: string): string[] {
  // Simple keyword extraction for common Changi Jewel features
  const keywords = [
    "rain vortex", "waterfall", "canopy park", "garden", "shopping", "restaurant",
    "airport", "terminal", "departure", "arrival", "check-in", "security",
    "architecture", "glass", "steel", "modern", "contemporary", "design",
    "trees", "plants", "nature", "indoor", "outdoor", "bridge", "walkway",
    "escalator", "elevator", "stairs", "floor", "ceiling", "wall", "window"
  ];

  const detected = keywords.filter(keyword => 
    analysis.toLowerCase().includes(keyword.toLowerCase())
  );

  return detected.length > 0 ? detected : ["general architecture"];
}
