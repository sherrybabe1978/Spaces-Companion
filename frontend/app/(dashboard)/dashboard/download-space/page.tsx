'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Download, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';

type Space = {
  id: number;
  spaceId: string;
  fileName: string | null;
  downloadUrl: string | null;
  status: string;
};

export default function DownloadSpacePage() {
  const [spaceId, setSpaceId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [downloadingSpaceId, setDownloadingSpaceId] = useState<number | null>(null);
  const [deletingSpaceId, setDeletingSpaceId] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchSpaces();
    const interval = setInterval(fetchSpaces, 5000); // Poll every 5 seconds
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
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      
      // Extract just the filename from the downloadUrl
      const filename = space.downloadUrl.split('/').pop();
      const downloadUrl = `${apiUrl}/${filename}`;
  
      const response = await fetch(downloadUrl, {
        method: 'GET',
      });
  
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Download failed');
      }
  
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = space.fileName || `space_${space.spaceId}.mp3`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to download file. Please try again.',
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

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full mb-8">
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
            disabled={isLoading || !spaceId}
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

      <Card>
        <CardHeader>
          <CardTitle>Your Spaces</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Space ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spaces.map((space) => (
                <TableRow key={space.id}>
                  <TableCell>{space.spaceId}</TableCell>
                  <TableCell>{space.fileName}</TableCell>
                  <TableCell>{space.status}</TableCell>
                  <TableCell>
                    <Progress value={getProgressValue(space.status)} className="w-[60%]" />
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
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
