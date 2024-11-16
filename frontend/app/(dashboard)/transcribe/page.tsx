// app/transcribe/page.tsx
'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { TranscriptPlayer } from '@/components/transcription-player';

type TranscriptionSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export default function TranscribePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transcription, setTranscription] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.type.includes('audio/')) {
        toast({
          title: 'Invalid file type',
          description: 'Please upload an audio file.',
          variant: 'destructive',
        });
        return;
      }
      setFile(selectedFile);
      
      // Clean up previous audio URL if it exists
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(URL.createObjectURL(selectedFile));
    }
  };

  const handleTranscribe = async () => {
    if (!file) return;

    setIsUploading(true);
    setProgress(0);
    setTranscription('');
    setSegments([]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to transcribe audio');
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setTranscription(data.text);
      setSegments(data.segments);
      setProgress(100);

      toast({
        title: 'Transcription complete',
        description: 'Your audio has been successfully transcribed.',
      });
    } catch (error) {
      console.error('Transcription error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to transcribe audio. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle>Transcribe Audio</CardTitle>
          <CardDescription>Upload an audio file to transcribe it using Groq API</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col space-y-1.5">
            <Label htmlFor="audio">Audio File</Label>
            <Input
              id="audio"
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              ref={fileInputRef}
            />
          </div>
          
          {isUploading && (
            <div className="space-y-2">
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-gray-500 text-center">{progress}% complete</p>
            </div>
          )}

          {audioUrl && segments.length > 0 && (
            <div className="mt-6">
              <TranscriptPlayer
                audioUrl={audioUrl}
                segments={segments}
              />
            </div>
          )}

          {!segments.length && transcription && (
            <div className="mt-4">
              <Label>Transcription</Label>
              <div className="p-4 bg-gray-50 rounded-md mt-2">
                <p className="whitespace-pre-wrap">{transcription}</p>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleTranscribe}
            disabled={!file || isUploading}
            className="w-full"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transcribing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Transcribe Audio
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
