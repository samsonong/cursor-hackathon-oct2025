"use client";

import { useEffect, useState } from "react";

type ImageAnalysis = {
  id: string;
  timestamp: string;
  savedAt: string;
  placeName: string;
  imageAnalysis: string;
  detectedObjects: string[];
  tourGuideResponse: string;
  filename: string;
};

type AnalysesResponse = {
  analyses: ImageAnalysis[];
  total: number;
  storageDir: string;
};

export default function AdminPage() {
  const [analyses, setAnalyses] = useState<ImageAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageDir, setStorageDir] = useState<string>("");
  const [selectedAnalysis, setSelectedAnalysis] = useState<ImageAnalysis | null>(null);

  const fetchAnalyses = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/image-context');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: AnalysesResponse = await response.json();
      setAnalyses(data.analyses);
      setStorageDir(data.storageDir);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analyses');
      console.error('Failed to fetch analyses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyses();
  }, []);

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Image Analysis Admin</h1>
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-400">Loading analyses...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Image Analysis Admin</h1>
            <p className="text-slate-400 mt-2">
              Viewing saved image analyses from: <code className="bg-slate-800 px-2 py-1 rounded text-sm">{storageDir}</code>
            </p>
          </div>
          <button
            onClick={fetchAnalyses}
            className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-200">Error: {error}</p>
          </div>
        )}

        {analyses.length === 0 ? (
          <div className="bg-slate-800/50 rounded-lg p-8 text-center">
            <p className="text-slate-400 text-lg">No image analyses found</p>
            <p className="text-slate-500 text-sm mt-2">
              Upload and analyze some images first to see them here.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Analysis List */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Saved Analyses ({analyses.length})</h2>
              <div className="space-y-3 max-h-screen overflow-y-auto">
                {analyses.map((analysis) => (
                  <div
                    key={analysis.id}
                    className={`bg-slate-800/60 rounded-lg p-4 cursor-pointer transition-all hover:bg-slate-800/80 border-2 ${
                      selectedAnalysis?.id === analysis.id
                        ? "border-emerald-500"
                        : "border-transparent"
                    }`}
                    onClick={() => setSelectedAnalysis(analysis)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-medium text-slate-100">{analysis.placeName}</h3>
                        <p className="text-xs text-slate-400">
                          {formatTimestamp(analysis.savedAt)}
                        </p>
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {analysis.filename}
                      </div>
                    </div>
                    
                    <p className="text-sm text-slate-300 line-clamp-3">
                      {analysis.tourGuideResponse}
                    </p>
                    
                    {analysis.detectedObjects && analysis.detectedObjects.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {analysis.detectedObjects.slice(0, 3).map((obj, idx) => (
                          <span
                            key={idx}
                            className="bg-emerald-600/20 text-emerald-200 text-xs px-2 py-1 rounded"
                          >
                            {obj}
                          </span>
                        ))}
                        {analysis.detectedObjects.length > 3 && (
                          <span className="text-xs text-slate-400">
                            +{analysis.detectedObjects.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Selected Analysis Details */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Analysis Details</h2>
              {selectedAnalysis ? (
                <div className="bg-slate-800/60 rounded-lg p-6 space-y-4">
                  <div>
                    <h3 className="text-lg font-medium text-emerald-200 mb-2">
                      {selectedAnalysis.placeName}
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-400">Analyzed:</span>
                        <p className="text-slate-200">{formatTimestamp(selectedAnalysis.timestamp)}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Saved:</span>
                        <p className="text-slate-200">{formatTimestamp(selectedAnalysis.savedAt)}</p>
                      </div>
                    </div>
                    <div className="mt-2">
                      <span className="text-slate-400">File:</span>
                      <p className="text-slate-200 font-mono text-sm">{selectedAnalysis.filename}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-md font-medium text-slate-200 mb-2">AI Analysis</h4>
                    <div className="bg-slate-900/50 rounded p-4">
                      <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {selectedAnalysis.imageAnalysis}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-md font-medium text-slate-200 mb-2">Tour Guide Response</h4>
                    <div className="bg-slate-900/50 rounded p-4">
                      <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {selectedAnalysis.tourGuideResponse}
                      </p>
                    </div>
                  </div>

                  {selectedAnalysis.detectedObjects && selectedAnalysis.detectedObjects.length > 0 && (
                    <div>
                      <h4 className="text-md font-medium text-slate-200 mb-2">
                        Detected Objects ({selectedAnalysis.detectedObjects.length})
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedAnalysis.detectedObjects.map((obj, idx) => (
                          <span
                            key={idx}
                            className="bg-emerald-600/20 text-emerald-200 text-sm px-3 py-1 rounded-full"
                          >
                            {obj}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-800/30 rounded-lg p-8 text-center">
                  <p className="text-slate-400">Select an analysis from the left to view details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}