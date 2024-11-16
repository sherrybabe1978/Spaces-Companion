import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Downloader } from './index.js';
import { DownloaderOptions } from './types.js';
import dotenv from 'dotenv';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs-extra';
import pkg from 'pg';
import cluster from 'cluster';
import os from 'os';
import rateLimit from 'express-rate-limit';

const { Pool } = pkg;

dotenv.config();

// Number of CPU cores
const numCPUs = os.cpus().length;

// Track active downloads across workers
const activeDownloads = new Map();

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  // Fork workers based on CPU cores
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    // Replace the dead worker
    cluster.fork();
  });
} else {
  const app = express();
  const port = process.env.PORT || 3000;

  // Increase payload size limit
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cors());

  // Add request timeout
  app.use((req, res, next) => {
    req.setTimeout(900000); // 15 minutes timeout
    next();
  });

  // Add rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  });
  app.use(limiter);

  // Ensure all required environment variables are defined
  const requiredEnvVars = [
    'DATABASE_URL',
    'GCP_PROJECT_ID',
    'GCP_BUCKET_NAME',
    'GCP_KEY_FILENAME',
    'TWITTER_USERNAME',
    'TWITTER_PASSWORD',
    'OUTPUT_PATH'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`${envVar} is not defined in the environment variables`);
    }
  }

  // Create a new pool using the connection string with better concurrent handling
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    max: 20, // maximum number of clients in the pool
    idleTimeoutMillis: 90000,
    connectionTimeoutMillis: 2000,
  });

  // Initialize Google Cloud Storage
  const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILENAME || ''),
  });
  const bucket = storage.bucket(process.env.GCP_BUCKET_NAME || '');

  // Helper function to clean up downloads
  async function cleanupDownload(workingDir: string, outputPath: string, task: Downloader) {
    try {
      // Delete the working directory and all its contents
      await fs.remove(workingDir);
      console.log(`Deleted working directory: ${workingDir}`);

      // Delete the output file if it exists
      if (await fs.pathExists(outputPath)) {
        await fs.remove(outputPath);
        console.log(`Deleted output file: ${outputPath}`);
      }

      // Run any additional cleanup tasks
      await task.cleanup();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  app.post('/download-space', async (req: any, res: any) => {
    const { spaceId, spaceDbId } = req.body;

    if (!spaceId || !spaceDbId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Generate a unique working directory for each request
    const workingDir = path.join(process.env.OUTPUT_PATH || './downloads', `${spaceId}-${Date.now()}`);

    const options: DownloaderOptions = {
      id: spaceId,
      username: process.env.TWITTER_USERNAME || '',
      password: process.env.TWITTER_PASSWORD || '',
      output: workingDir,
    };

    let task: Downloader | undefined;

    try {
      // Add request to active downloads tracking
      activeDownloads.set(spaceDbId, { status: 'processing', progress: 0 });

      task = await new Downloader(options).init();

      // Set up progress tracking
      task.on('progress', async (progress: number) => {
        try {
          await pool.query(
            'UPDATE spaces SET status = $1 WHERE id = $2',
            [`downloading: ${progress}%`, spaceDbId]
          );
          // Update active downloads tracking
          activeDownloads.set(spaceDbId, { status: 'processing', progress });
        } catch (error) {
          console.error('Error updating progress:', error);
        }
      });

      // Generate audio and get the output path
      await task.generateAudio();
      const outputPath = task.getOutputPath();

      // Upload file to Google Cloud Storage
      const gcsFileName = `spaces/${spaceId}/${path.basename(outputPath)}`;
      await bucket.upload(outputPath, {
        destination: gcsFileName,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
        resumable: false // Faster for files under 5MB
      });

      // Get the public URL
      const publicUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${gcsFileName}`;

      // Update the database
      await pool.query(
        'UPDATE spaces SET file_name = $1, download_url = $2, status = $3 WHERE id = $4',
        [
          path.basename(outputPath),
          publicUrl,
          'completed',
          spaceDbId
        ]
      );

      // Cleanup
      await cleanupDownload(workingDir, outputPath, task);
      activeDownloads.delete(spaceDbId);

      return res.json({ 
        message: 'Space downloaded, uploaded successfully, and all temporary files deleted', 
        publicUrl,
        spaceId,
        spaceDbId 
      });

    } catch (error: any) {
      console.error('Error downloading space:', error);
      activeDownloads.delete(spaceDbId);
      
      await pool.query(
        'UPDATE spaces SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message || 'Unknown error', spaceDbId]
      );

      // Attempt to clean up even if an error occurred
      if (task) {
        try {
          await cleanupDownload(workingDir, task.getOutputPath(), task);
        } catch (cleanupError) {
          console.error('Error during cleanup after failure:', cleanupError);
        }
      }

      return res.status(500).json({ 
        error: 'Failed to download space',
        message: error.message,
        spaceId,
        spaceDbId
      });
    }
  });

  app.get('/spaces', async (req: Request, res: Response) => {
    try {
      const result = await pool.query('SELECT * FROM spaces ORDER BY id DESC');
      res.json({ spaces: result.rows });
    } catch (error) {
      console.error('Error fetching spaces:', error);
      res.status(500).json({ error: 'Failed to fetch spaces' });
    }
  });

  // Add endpoint to check download status
  app.get('/download-status/:spaceDbId', (req: Request, res: Response) => {
    const { spaceDbId } = req.params;
    const downloadStatus = activeDownloads.get(parseInt(spaceDbId));
    res.json(downloadStatus || { status: 'not found' });
  });

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'healthy', worker: process.pid });
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  });

  app.listen(port, () => {
    console.log(`Worker ${process.pid} running on port ${port}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await pool.end();
    process.exit(0);
  });
}
