import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = "nodejs";

const CONVERSATION_HISTORY_PATH = join(process.cwd(), 'data', 'conversation-history.json');

interface ImageContextPayload {
  timestamp?: string;
  placeName?: string;
  imageAnalysis?: unknown;
  detectedObjects?: unknown;
  tourGuideResponse?: unknown;
  sessionId?: string;
  [key: string]: unknown;
}

async function saveImageAnalysis(imageContext: ImageContextPayload) {
  console.log('=== SAVE IMAGE ANALYSIS START ===');
  console.log('Input imageContext:', JSON.stringify(imageContext, null, 2));
  
  try {
    // Read existing conversation history
    console.log('Reading conversation history from:', CONVERSATION_HISTORY_PATH);
    let conversationHistory;
    try {
      const content = await readFile(CONVERSATION_HISTORY_PATH, 'utf-8');
      conversationHistory = JSON.parse(content);
      console.log('Successfully read conversation history');
    } catch (error) {
      console.warn('Could not read conversation history, creating new:', error);
      conversationHistory = {};
    }
    
    const analysisData = {
      user: `Image uploaded for analysis at ${imageContext.placeName}`,
      assistant: `${imageContext.imageAnalysis}\n\nDetected Objects: ${imageContext.detectedObjects ? (Array.isArray(imageContext.detectedObjects) ? imageContext.detectedObjects.join(', ') : imageContext.detectedObjects) : 'None'}\n\nTour Guide Response: ${imageContext.tourGuideResponse}`,
      timestamp: new Date().toISOString(),
      sessionId: imageContext.sessionId || 'image-analysis'
    };
    
    console.log('Created analysis data:', JSON.stringify(analysisData, null, 2));
    
    // Use sessionId or create 'image-analysis' session
    const sessionId = imageContext.sessionId || 'image-analysis';
    console.log('Using session ID:', sessionId);
    
    if (!conversationHistory[sessionId]) {
      conversationHistory[sessionId] = [];
      console.log('Created new session array for:', sessionId);
    }
    
    conversationHistory[sessionId].push(analysisData);
    console.log('Added analysis to session, total entries:', conversationHistory[sessionId].length);
    
    // Write back to conversation history
    console.log('Writing back to conversation history...');
    await writeFile(CONVERSATION_HISTORY_PATH, JSON.stringify(conversationHistory, null, 2), 'utf-8');
    
    console.log(`Image analysis saved to conversation history: ${CONVERSATION_HISTORY_PATH}`);
    console.log('=== SAVE IMAGE ANALYSIS SUCCESS ===');
    return analysisData;
  } catch (error) {
    console.error('=== SAVE IMAGE ANALYSIS ERROR ===');
    console.error('Failed to save image analysis:', error);
    throw error;
  }
}

export async function POST(req: Request) {
  console.log('=== POST REQUEST START ===');
  try {
    console.log('Parsing request body...');
    const body = await req.json().catch((parseError) => {
      console.error('JSON parse error:', parseError);
      return {};
    });
    
    console.log('Request body:', JSON.stringify(body, null, 2));

    const imageContext = body?.imageContext;
    console.log('Extracted imageContext:', JSON.stringify(imageContext, null, 2));

    if (!imageContext) {
      console.error('Missing imageContext parameter');
      return Response.json(
        { error: "Missing 'imageContext' parameter." },
        { status: 400 }
      );
    }

    console.log('Calling saveImageAnalysis...');
    const savedAnalysis = await saveImageAnalysis(imageContext);
    console.log('saveImageAnalysis completed successfully');

    const response = {
      success: true,
      message: "Image analysis saved to conversation history",
      timestamp: savedAnalysis.timestamp,
      sessionId: savedAnalysis.sessionId,
    };
    
    console.log('Sending response:', JSON.stringify(response, null, 2));
    console.log('=== POST REQUEST SUCCESS ===');
    
    return Response.json(response);
  } catch (err: unknown) {
    console.error('=== POST REQUEST ERROR ===');
    console.error("Image context API error:", err);
    console.error("Error stack:", err instanceof Error ? err.stack : 'No stack trace');
    
    const errorResponse = {
      error:
        err && typeof err === "object" && "message" in err
          ? String(
              (err as { message?: unknown }).message ?? "Unexpected error"
            )
          : "Unexpected error",
    };
    
    console.log('Sending error response:', JSON.stringify(errorResponse, null, 2));
    
    return Response.json(errorResponse, { status: 500 });
  }
}

export async function GET(req: Request) {
  console.log('=== GET REQUEST START ===');
  try {
    const url = new URL(req.url);
    const placeName = url.searchParams.get("placeName");
    const limit = parseInt(url.searchParams.get("limit") || "10");
    
    console.log('GET parameters:', { placeName, limit });
    
    // Read conversation history
    console.log('Reading conversation history from:', CONVERSATION_HISTORY_PATH);
    let conversationHistory;
    try {
      const content = await readFile(CONVERSATION_HISTORY_PATH, 'utf-8');
      conversationHistory = JSON.parse(content);
      console.log('Successfully read conversation history, sessions:', Object.keys(conversationHistory));
    } catch (error) {
      console.warn("Could not read conversation history:", error);
      return Response.json({
        analyses: [],
        total: 0,
        source: "conversation-history.json",
      });
    }
    
    const analyses = [];
    
    // Collect all image analyses from all sessions
    for (const sessionId in conversationHistory) {
      const session = conversationHistory[sessionId];
      console.log(`Processing session ${sessionId}, entries: ${Array.isArray(session) ? session.length : 'not array'}`);
      
      if (Array.isArray(session)) {
        const imageAnalyses = session.filter(entry => 
          entry.user && entry.user.includes('Image uploaded for analysis')
        );
        
        console.log(`Found ${imageAnalyses.length} image analyses in session ${sessionId}`);
        
        for (const analysis of imageAnalyses) {
          // Filter by place name if specified (extract from user message)
          if (!placeName || analysis.user.includes(placeName)) {
            analyses.push(analysis);
            console.log('Added analysis:', { timestamp: analysis.timestamp, sessionId: analysis.sessionId });
          }
        }
      }
    }
    
    console.log(`Total analyses found: ${analyses.length}`);
    
    // Sort by timestamp in descending order (most recent first)
    analyses.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Apply limit
    const limitedAnalyses = analyses.slice(0, limit);
    console.log(`Returning ${limitedAnalyses.length} analyses after limit`);

    const response = {
      analyses: limitedAnalyses,
      total: limitedAnalyses.length,
      source: "conversation-history.json",
    };
    
    console.log('=== GET REQUEST SUCCESS ===');
    return Response.json(response);
  } catch (err: unknown) {
    console.error('=== GET REQUEST ERROR ===');
    console.error("Image context fetch error:", err);
    console.error("Error stack:", err instanceof Error ? err.stack : 'No stack trace');
    
    const errorResponse = {
      error:
        err && typeof err === "object" && "message" in err
          ? String(
              (err as { message?: unknown }).message ?? "Unexpected error"
            )
          : "Unexpected error",
    };
    
    console.log('Sending GET error response:', JSON.stringify(errorResponse, null, 2));
    
    return Response.json(errorResponse, { status: 500 });
  }
}
