import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Downloader } from './index.js';
import { DownloaderOptions } from './types.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
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
    req.setTimeout(300000); // 5 minutes timeout
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
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

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

    try {
      // Add request to active downloads tracking
      activeDownloads.set(spaceDbId, { status: 'processing', progress: 0 });

      const task = await new Downloader(options).init();

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

      // Move the file to the downloads folder
      const downloadsFolderPath = path.join(process.env.OUTPUT_PATH || './downloads');
      const finalFilePath = path.join(downloadsFolderPath, path.basename(outputPath));
      await fs.promises.rename(outputPath, finalFilePath);

      // Update the database
      await pool.query(
        'UPDATE spaces SET file_name = $1, download_url = $2, status = $3 WHERE id = $4',
        [
          path.basename(finalFilePath),
          finalFilePath,
          'completed',
          spaceDbId
        ]
      );

      // Cleanup
      await task.cleanup();
      activeDownloads.delete(spaceDbId);

      res.json({ 
        message: 'Space downloaded and saved successfully', 
        filePath: finalFilePath,
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

      res.status(500).json({ 
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

  app.get('/downloads/:filename', (req: any, res: any) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(process.env.OUTPUT_PATH || './downloads', filename);
  
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.log('File not found:', filePath);
        return res.status(404).json({ error: 'File not found' });
      }
  
      // Set appropriate headers
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
  
      // Handle errors
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
    } catch (error) {
      console.error('Error handling download:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });
  
  // Also serve static files from the downloads directory
  app.use('/downloads', express.static(path.join(process.cwd(), 'downloads')));

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'healthy', worker: process.pid });
  });

  app.get('/api/download-space/:filename', (req: any, res: any) => {
    const filename = req.params.filename;
    const filePath = path.join(process.env.OUTPUT_PATH || './downloads', filename);
  
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
  
    // Set appropriate headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  
    // Handle errors
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      res.status(500).json({ error: 'Error streaming file' });
    });
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: Function) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  });

  app.listen(port, () => {
    console.log(`Worker ${process.pid} running on port ${port}`);
  });

  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001', // Your Next.js app URL
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true
  }));
  
  
  
    

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await pool.end();
    process.exit(0);
  });
}
