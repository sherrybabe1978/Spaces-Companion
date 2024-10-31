'use client';

import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface TranscriptSegment {
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
}

interface TranscriptPlayerProps {
  audioUrl: string;
  segments: TranscriptSegment[];
}

export function TranscriptPlayer({ audioUrl, segments }: TranscriptPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current;

      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime);
        highlightCurrentSegment(audio.currentTime);
      };

      const handleLoadedMetadata = () => {
        setDuration(audio.duration);
      };

      const handleEnded = () => {
        setIsPlaying(false);
      };

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('ended', handleEnded);

      return () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('ended', handleEnded);
      };
    }
  }, []);

  const highlightCurrentSegment = (time: number) => {
    const currentSegment = segments.find(
      segment => time >= segment.start && time <= segment.end
    );

    if (currentSegment && transcriptRef.current) {
      const segmentElement = transcriptRef.current.querySelector(
        `[data-segment-id="${currentSegment.id}"]`
      );

      if (segmentElement) {
        segmentElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  };

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  };

  const skipForward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime += 10;
    }
  };

  const skipBackward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime -= 10;
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSegmentClick = (segment: TranscriptSegment) => {
    if (audioRef.current) {
      audioRef.current.currentTime = segment.start;
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  return (
    <div className="space-y-4">
      <audio ref={audioRef} src={audioUrl} className="hidden" />
      
      <div className="flex items-center justify-center space-x-4">
        <Button
          variant="outline"
          size="icon"
          onClick={skipBackward}
          className="rounded-full"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        
        <Button
          onClick={togglePlayPause}
          variant="outline"
          size="icon"
          className="rounded-full"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        
        <Button
          variant="outline"
          size="icon"
          onClick={skipForward}
          className="rounded-full"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Slider
          value={[currentTime]}
          max={duration}
          step={0.1}
          onValueChange={handleSeek}
          className="w-full"
        />
        <div className="flex justify-between text-sm text-gray-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div 
        ref={transcriptRef}
        className="h-[400px] overflow-y-auto space-y-2 p-4 bg-gray-50 rounded-lg"
      >
        {segments.map((segment) => (
          <div
            key={segment.id}
            data-segment-id={segment.id}
            className={`p-2 rounded cursor-pointer transition-colors ${
              currentTime >= segment.start && currentTime <= segment.end
                ? 'bg-purple-100'
                : 'hover:bg-gray-100'
            }`}
            onClick={() => handleSegmentClick(segment)}
          >
            <span className="text-xs text-gray-500 mr-2">
              {formatTime(segment.start)}
            </span>
            {segment.text}
          </div>
        ))}
      </div>
    </div>
  );
}
