// app/dashboard/download-space/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Download, Trash2, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { TranscriptionViewer } from '@/components/ui/transcription-viewer';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

type Space = {
  id: number;
  spaceId: string;
  fileName: string | null;
  downloadUrl: string | null;
  status: string;
};

type UserPlan = {
  plan: string;
  storedSpaces: number;
  limit: number;
};

export default function DownloadSpacePage() {
  const [spaceId, setSpaceId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [downloadingSpaceId, setDownloadingSpaceId] = useState<number | null>(null);
  const [deletingSpaceId, setDeletingSpaceId] = useState<number | null>(null);
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<Record<number, string>>({});
  const [transcriptions, setTranscriptions] = useState<Record<number, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    fetchSpaces();
    fetchUserPlan();
    fetchTranscriptions();
    const interval = setInterval(() => {
      fetchSpaces();
      fetchTranscriptions();
    }, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchSpaces = async () => {
    try {
      const response = await fetch('/api/download-space');
      if (!response.ok) {
        throw new Error('Failed to fetch spaces');
      }
      const data = await response.json();
      setSpaces(data.spaces);
    } catch (error) {
      console.error('Error fetching spaces:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch spaces. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const fetchUserPlan = async () => {
    try {
      const response = await fetch('/api/user-plan');
      if (!response.ok) {
        throw new Error('Failed to fetch user plan');
      }
      const data = await response.json();
      setUserPlan(data);
    } catch (error) {
      console.error('Error fetching user plan:', error);
    }
  };

  const fetchTranscriptions = async () => {
    try {
      const response = await fetch('/api/transcriptions');
      if (!response.ok) {
        throw new Error('Failed to fetch transcriptions');
      }
      const data = await response.json();
      const transcriptionMap = data.transcriptions.reduce((acc: Record<number, boolean>, t: { spaceId: number }) => {
        acc[t.spaceId] = true;
        return acc;
      }, {});
      setTranscriptions(transcriptionMap);
    } catch (error) {
      console.error('Error fetching transcriptions:', error);
    }
  };

  const handleDownload = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/download-space', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ spaceId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to download space');
      }

      const data = await response.json();
      toast({
        title: 'Space download initiated',
        description: 'The download has started. You can track the progress in the table.',
      });
      fetchSpaces();
      fetchUserPlan();
    } catch (error: any) {
      console.error('Error downloading space:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to download space. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setSpaceId('');
    }
  };

  const getProgressValue = (status: string) => {
    if (status.startsWith('downloading:')) {
      return parseInt(status.split(':')[1]);
    }
    return status === 'completed' ? 100 : 0;
  };

  const handleFileDownload = async (space: Space) => {
    if (!space.downloadUrl) return;

    setDownloadingSpaceId(space.id);
    try {
      const fileName = space.downloadUrl.split('/').slice(-3).join('/');
      
      const response = await fetch(`/api/get-download-url?fileName=${encodeURIComponent(fileName)}`, {
        method: 'GET',
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = space.fileName || `space_${space.spaceId}.mp3`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      toast({
        title: 'Error',
        description: 'Failed to download file. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloadingSpaceId(null);
    }
  };

  const handleDelete = async (space: Space) => {
    setDeletingSpaceId(space.id);
    try {
      const response = await fetch(`/api/delete-space?id=${space.id}`, {
        method: 'DELETE',
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        throw new Error(data.error || 'Delete failed');
      }
  
      toast({
        title: 'Space deleted',
        description: data.message || 'The space has been successfully deleted.',
      });
      fetchSpaces();
      fetchUserPlan();
    } catch (error: any) {
      console.error('Error deleting space:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete space. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeletingSpaceId(null);
    }
  };

  const handleTranscribe = async (space: Space) => {
    try {
      setTranscriptionStatus(prev => ({ ...prev, [space.id]: 'loading' }));
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ spaceId: space.id }),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate transcription');
      }

      setTranscriptionStatus(prev => ({ ...prev, [space.id]: 'in_progress' }));
      toast({
        title: 'Transcription initiated',
        description: 'The transcription process has started. You can view the progress in the table.',
      });
      // Update the transcriptions state to show that this space now has a transcription
      setTranscriptions(prev => ({ ...prev, [space.id]: true }));
    } catch (error) {
      console.error('Error initiating transcription:', error);
      setTranscriptionStatus(prev => ({ ...prev, [space.id]: 'error' }));
      toast({
        title: 'Error',
        description: 'Failed to initiate transcription. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-md mx-auto mb-8">
        <CardHeader>
          <CardTitle>Download X Space</CardTitle>
          <CardDescription>Enter the Space ID to download the audio</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="spaceId">Space ID</Label>
              <Input
                id="spaceId"
                placeholder="Enter Space ID"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            onClick={handleDownload} 
            disabled={isLoading || !spaceId || (userPlan && userPlan.storedSpaces >= userPlan.limit)}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download Space
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {userPlan && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Your Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Current Plan: {userPlan.plan}</p>
            <p>Stored Spaces: {userPlan.storedSpaces} / {userPlan.limit}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {spaces.map((space) => (
          <Card key={space.id}>
            <CardHeader>
              <CardTitle>{space.fileName || `Space ${space.spaceId}`}</CardTitle>
              <CardDescription>Status: {space.status}</CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={getProgressValue(space.status)} className="w-full mb-4" />
              <div className="flex flex-col space-y-2">
                {space.downloadUrl && (
                  <Button
                    variant="outline"
                    onClick={() => handleFileDownload(space)}
                    disabled={downloadingSpaceId === space.id}
                  >
                    {downloadingSpaceId === space.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </>
                    )}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => handleDelete(space)}
                  disabled={deletingSpaceId === space.id}
                >
                  {deletingSpaceId === space.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </>
                  )}
                </Button>
                {!transcriptions[space.id] ? (
                  <Button
                    variant="outline"
                    onClick={() => handleTranscribe(space)}
                    disabled={transcriptionStatus[space.id] === 'loading' || transcriptionStatus[space.id] === 'in_progress'}
                  >
                    {transcriptionStatus[space.id] === 'loading' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Initiating...
                      </>
                    ) : transcriptionStatus[space.id] === 'in_progress' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Transcribing...
                      </>
                    ) : (
                      <>
                        <FileText className="mr-2 h-4 w-4" />
                        Transcribe
                      </>
                    )}
                  </Button>
                ) : (
                  <Drawer>
                    <DrawerTrigger asChild>
                      <Button variant="outline">
                        <FileText className="mr-2 h-4 w-4" />
                        View Transcription
                      </Button>
                    </DrawerTrigger>
                    <DrawerContent>
                      <div className="mx-auto w-full max-w-4xl">
                        <DrawerHeader>
                          <DrawerTitle>Transcription for {space.fileName || `Space ${space.spaceId}`}</DrawerTitle>
                        </DrawerHeader>
                        <div className="p-4 pb-0">
                          <TranscriptionViewer spaceId={space.id} />
                        </div>
                        <DrawerFooter>
                          <DrawerClose asChild>
                            <Button variant="outline">Close</Button>
                          </DrawerClose>
                        </DrawerFooter>
                      </div>
                    </DrawerContent>
                  </Drawer>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
