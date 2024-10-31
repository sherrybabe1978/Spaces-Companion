'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, Download, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { TranscriptPlayer } from '@/components/transcription-player';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

type Transcription = {
  id: number;
  fileName: string;
  content: string;
  segments: string;
  status: string;
  createdAt: string;
};

export default function TranscribePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transcription, setTranscription] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [downloadFormat, setDownloadFormat] = useState<'txt' | 'srt' | 'vtt'>('txt');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [selectedTranscription, setSelectedTranscription] = useState<Transcription | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchTranscriptions();
  }, []);

  const fetchTranscriptions = async () => {
    try {
      const response = await fetch('/api/transcriptions');
      if (!response.ok) throw new Error('Failed to fetch transcriptions');
      const data = await response.json();
      setTranscriptions(data.transcriptions);
    } catch (error) {
      console.error('Error fetching transcriptions:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch transcription history',
        variant: 'destructive',
      });
    }
  };

  const formatTime = (seconds: number, format: 'srt' | 'vtt') => {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
    
    return format === 'srt' 
      ? `${hours}:${minutes}:${secs},${ms}`
      : `${hours}:${minutes}:${secs}.${ms}`;
  };

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
      formData.append('fileName', file.name);

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

      // Refresh transcriptions after successful transcription
      fetchTranscriptions();
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

  const handleViewTranscription = (transcription: Transcription) => {
    setSelectedTranscription(transcription);
    setTranscription(transcription.content);
    setSegments(JSON.parse(transcription.segments || '[]'));
  };

  const handleDownloadTranscription = (content: string = transcription) => {
    if (!content) return;

    let finalContent = '';
    let extension = downloadFormat;
    let mimeType = 'text/plain';

    if (segments.length > 0) {
      switch (downloadFormat) {
        case 'srt':
          finalContent = segments.map((segment, index) => {
            return `${index + 1}\n${formatTime(segment.start, 'srt')} --> ${formatTime(segment.end, 'srt')}\n${segment.text}\n`;
          }).join('\n');
          mimeType = 'application/x-subrip';
          break;
        case 'vtt':
          finalContent = `WEBVTT\n\n${segments.map((segment, index) => {
            return `${formatTime(segment.start, 'vtt')} --> ${formatTime(segment.end, 'vtt')}\n${segment.text}\n`;
          }).join('\n')}`;
          mimeType = 'text/vtt';
          break;
        default:
          finalContent = segments.map(segment => {
            const timeStart = new Date(segment.start * 1000).toISOString().substr(11, 8);
            const timeEnd = new Date(segment.end * 1000).toISOString().substr(11, 8);
            return `[${timeStart} - ${timeEnd}]\n${segment.text}`;
          }).join('\n\n');
      }
    } else {
      finalContent = content;
    }

    const blob = new Blob([finalContent], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `transcription_${new Date().toISOString().split('T')[0]}.${extension}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast({
      title: 'Transcription downloaded',
      description: `Your transcription has been saved as a ${extension.toUpperCase()} file.`,
    });
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-3xl mx-auto mb-8">
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
        <CardFooter className="flex flex-col sm:flex-row gap-4">
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

          {(transcription || segments.length > 0) && (
            <div className="flex flex-col sm:flex-row gap-4 w-full">
              <Select
                value={downloadFormat}
                onValueChange={(value) => setDownloadFormat(value as 'txt' | 'srt' | 'vtt')}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="txt">Plain Text</SelectItem>
                  <SelectItem value="srt">SubRip (SRT)</SelectItem>
                  <SelectItem value="vtt">WebVTT</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => handleDownloadTranscription()}
                variant="outline"
                className="flex-1"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Transcription
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>

      {/* Transcription History */}
      <Card className="w-full max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle>Transcription History</CardTitle>
          <CardDescription>Your previous transcriptions</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transcriptions.map((transcription) => (
                <TableRow key={transcription.id}>
                  <TableCell>{transcription.fileName}</TableCell>
                  <TableCell>
                    {new Date(transcription.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{transcription.status}</TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewTranscription(transcription)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadTranscription(transcription.content)}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
