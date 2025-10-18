import { writeFile, readdir, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const runtime = "nodejs";

const STORAGE_DIR = join(process.cwd(), 'image-analyses');

async function ensureStorageDir() {
  try {
    await mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
  }
}

async function saveImageAnalysis(imageContext: any) {
  await ensureStorageDir();
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `analysis-${timestamp}.json`;
  const filepath = join(STORAGE_DIR, filename);
  
  const analysisData = {
    id: `analysis_${Date.now()}`,
    timestamp: imageContext.timestamp,
    savedAt: new Date().toISOString(),
    placeName: imageContext.placeName,
    imageAnalysis: imageContext.imageAnalysis,
    detectedObjects: imageContext.detectedObjects,
    tourGuideResponse: imageContext.tourGuideResponse,
    filename: filename,
  };
  
  await writeFile(filepath, JSON.stringify(analysisData, null, 2), 'utf-8');
  
  console.log(`Image analysis saved to: ${filepath}`);
  return analysisData;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    
    const imageContext = body?.imageContext;
    
    if (!imageContext) {
      return Response.json(
        { error: "Missing 'imageContext' parameter." },
        { status: 400 }
      );
    }

    const savedAnalysis = await saveImageAnalysis(imageContext);

    return Response.json({
      success: true,
      message: "Image analysis saved to JSON file",
      contextId: savedAnalysis.id,
      filename: savedAnalysis.filename,
      savedAt: savedAnalysis.savedAt,
    });
  } catch (err: unknown) {
    console.error("Image context API error:", err);
    return Response.json(
      {
        error:
          err && typeof err === "object" && "message" in err
            ? String(
                (err as { message?: unknown }).message ?? "Unexpected error"
              )
            : "Unexpected error",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    await ensureStorageDir();
    
    const url = new URL(req.url);
    const placeName = url.searchParams.get("placeName");
    const limit = parseInt(url.searchParams.get("limit") || "10");
    
    // Read all JSON files from storage directory
    const files = await readdir(STORAGE_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json') && file.startsWith('analysis-'));
    
    // Sort by filename (which includes timestamp) in descending order
    jsonFiles.sort().reverse();
    
    const analyses = [];
    
    for (const file of jsonFiles.slice(0, limit)) {
      try {
        const filepath = join(STORAGE_DIR, file);
        const content = await readFile(filepath, 'utf-8');
        const analysis = JSON.parse(content);
        
        // Filter by place name if specified
        if (!placeName || analysis.placeName === placeName) {
          analyses.push(analysis);
        }
      } catch (error) {
        console.warn(`Failed to read analysis file ${file}:`, error);
      }
    }

    return Response.json({
      analyses,
      total: analyses.length,
      storageDir: STORAGE_DIR,
    });
  } catch (err: unknown) {
    console.error("Image context fetch error:", err);
    return Response.json(
      {
        error:
          err && typeof err === "object" && "message" in err
            ? String(
                (err as { message?: unknown }).message ?? "Unexpected error"
              )
            : "Unexpected error",
      },
      { status: 500 }
    );
  }
}
