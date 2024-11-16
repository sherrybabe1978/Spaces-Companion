// components/ui/transcription-viewer.tsx

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { TranscriptPlayer } from '@/components/transcription-player';

type TranscriptionViewerProps = {
  spaceId: number;
};

type Transcription = {
  id: number;
  content: string;
  segments: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export function TranscriptionViewer({ spaceId }: TranscriptionViewerProps) {
  const [transcription, setTranscription] = useState<Transcription | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTranscription();
    fetchAudioUrl();
  }, [spaceId]);

  const fetchTranscription = async () => {
    try {
      const response = await fetch(`/api/transcriptions/${spaceId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch transcription');
      }
      const data = await response.json();
      setTranscription(data);
    } catch (error) {
      setError('Failed to load transcription');
      console.error('Error fetching transcription:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAudioUrl = async () => {
    try {
      const response = await fetch(`/api/get-signed-url?spaceId=${spaceId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch audio URL');
      }
      const data = await response.json();
      setAudioUrl(data.url);
    } catch (error) {
      console.error('Error fetching audio URL:', error);
      setError('Failed to load audio');
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 text-center p-4">
        {error}
      </div>
    );
  }

  if (!transcription) {
    return (
      <div className="text-center p-4">
        No transcription available
      </div>
    );
  }

  const segments = JSON.parse(transcription.segments);

  return (
    <Card>
      <CardContent>
        {transcription.status === 'in_progress' && (
          <div className="mb-4 flex items-center text-purple-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span>Transcription in progress...</span>
          </div>
        )}
        {audioUrl && segments && (
          <TranscriptPlayer
            audioUrl={audioUrl}
            segments={segments}
          />
        )}
        {!segments && (
          <div className="whitespace-pre-wrap bg-gray-50 p-4 rounded-md">
            {transcription.content}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
