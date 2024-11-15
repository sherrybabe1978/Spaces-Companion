import * as CONSTANTS from './constants/constants.js';
import axios, { Axios, AxiosRequestHeaders, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import os from 'os';
// @ts-ignore
import m3u8Parser from 'm3u8-parser';
import { PassThrough } from 'stream';
import { getRequest, postRequest, print } from './utils/utils.js';
import { DownloaderOptions, TaskHeaders } from './types.js';
import fs from 'fs-extra';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

interface DownloaderInterface {
  [key: string]: any
}

export class Downloader extends EventEmitter implements DownloaderInterface {
  private username: string;
  private password: string;
  private phoneNumber: string;
  private options!: DownloaderOptions;
  private headers: TaskHeaders;
  private audioSpaceData!: Record<string, any>;
  private mediaKey!: string;
  private id: string;
  private isLoggedIn: boolean = false;
  private $: any;
  private playlist!: string;
  private playlistUrl!: string;
  private chunkBaseUrl!: string;
  private downloadChunksCount: number = 0;
  private storagePath;
  private chunksUrls!: string[];
  private output!: string;
  private mp3OutputFilePath!: string;

    getOutputPath(): string {
    return this.mp3OutputFilePath;
  }

  constructor(options: DownloaderOptions) {
    super();
    this.options = options;
    this.username = process.env.TWITTER_USERNAME || '';
    this.password = process.env.TWITTER_PASSWORD || '';
    this.phoneNumber = process.env.TWITTER_PHONE_NUMBER || '';
    this.id = options.id;
    this.output = options.output.replace('~/', `/${os.homedir()}/`);
    this.storagePath = path.join(this.output, `task-${this.id}`,);
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.100 Safari/537.36',
      'accept': "*/*",
      Referer: 'https://twitter.com/',
      'Content-Type': 'application/json',
    };

  }

  async init(): Promise<Downloader> {
    // await this.loginWithPuppeteer();
    if (!(await fs.pathExists(path.join(this.storagePath, "/", 'task-metadata.json')))) {
      const taskMetaData: Record<string, any> = {};
      print.info("Starting authentication flow");
      await this.login();
      await this.checkUser();
      print.info(`Retrieving space metadata: [${this.id}]`);
      await this.setSpaceMetadataAndMediaKey();
      const playListInfoResponse: AxiosResponse = await getRequest(CONSTANTS.PLAYLIST_INFO_URL(this.mediaKey), this.headers);
      this.playlistUrl = playListInfoResponse.data.source.location;

      print.info('Saving task metadata to disk');
      taskMetaData['audioSpaceData'] = this.audioSpaceData;
      taskMetaData['playlistUrl'] = this.playlistUrl;
      // Store the task metadata for later;
      await this.saveToDisk(JSON.stringify(taskMetaData), 'task-metadata.json');
    } else {
      const { audioSpaceData, playlistUrl } = await fs.readJson(path.join(this.storagePath, "/", "task-metadata.json"));
      this.playlistUrl = playlistUrl;
      this.audioSpaceData = audioSpaceData;
    }
    this.chunkBaseUrl = this.playlistUrl.replace(path.basename(this.playlistUrl), '');
    return this;
  }

  async login() {
    try {
      const response: AxiosResponse = await getRequest(CONSTANTS.URL_BASE, this.headers);
      this.$ = cheerio.load(response.data);
      print.info("Retrieving guest token...");
      this.headers['X-Guest-Token'] = await this.getGuestToken();
      this.headers["Authorization"] = CONSTANTS.BEARER;
      // Initialize login flow:
      let taskResponse: any;
      let taskInputs: any = CONSTANTS.LOGIN_FLOW_SUBTASK_DATA[''].input;
      taskResponse = (await postRequest(CONSTANTS.URL_FLOW_1, this.headers, JSON.stringify(taskInputs)));
      let flowToken: string = taskResponse.data.flow_token;
      // console.log(taskResponse.data)
      let nextSubtask: string = taskResponse.data.subtasks[0].subtask_id;

      const att: string = taskResponse.headers
        .get('set-cookie')
        .find((x: string) => x.startsWith('att='))
        .split('att=')[1]
        .split(';')[0];
      this.setHeaders({ cookie: `att=${att}` });


      if (this.options.browserLogin) {
        await this.loginWithPuppeteer();
        return;
      } else {
        print.info('Attempting to login with username and password. Make sure 2FA is disabled on your account');
      }

      while (!this.isLoggedIn) {
        if (Object.keys(CONSTANTS.LOGIN_FLOW_SUBTASK_DATA).find(x => x === nextSubtask) && !this.options.browserLogin) {
          print.info(`Performing next subtask: ${nextSubtask}`);
        } else {
          print.error(`Subtask ${nextSubtask} not recognized.`);
          if (!this.options.disableBrowserLogin) {
            await this.loginWithPuppeteer();
            return;
          }
          throw new Error("Something went wrong! Unable to login!");
          
        }

        if (nextSubtask === 'LoginJsInstrumentationSubtask') {
          taskInputs = { flow_token: flowToken, ...CONSTANTS.LOGIN_FLOW_SUBTASK_DATA[nextSubtask].input };
          taskResponse = await postRequest(CONSTANTS.URL_FLOW_2, this.headers, JSON.stringify(taskInputs));
          flowToken = taskResponse.data.flow_token;
          nextSubtask = taskResponse.data.subtasks[0].subtask_id;
        } else if (nextSubtask === 'LoginEnterUserIdentifierSSO') {
          print.default('Submitting username...');
          taskInputs = { flow_token: flowToken, ...CONSTANTS.LOGIN_FLOW_SUBTASK_DATA[nextSubtask](this.username).input }
          taskResponse = await postRequest(CONSTANTS.URL_FLOW_2, this.headers, JSON.stringify(taskInputs));
          flowToken = taskResponse.data.flow_token;
          // console.log(taskResponse.data)
          nextSubtask = taskResponse.data.subtasks[0].subtask_id;
        } else if (nextSubtask === 'LoginEnterPassword') {
          print.default('Submitting password...');
          taskInputs = { flow_token: flowToken, ...CONSTANTS.LOGIN_FLOW_SUBTASK_DATA[nextSubtask](this.password).input }
          taskResponse = await postRequest(CONSTANTS.URL_FLOW_2, this.headers, JSON.stringify(taskInputs));
          flowToken = taskResponse.data.flow_token;
          nextSubtask = taskResponse.data.subtasks[0].subtask_id;
        } else if (nextSubtask === 'AccountDuplicationCheck') {
          print.info('Performing account duplication check')
          taskInputs = { flow_token: flowToken, ...CONSTANTS.LOGIN_FLOW_SUBTASK_DATA[nextSubtask].input };
          taskResponse = await postRequest(CONSTANTS.URL_FLOW_2, this.headers, JSON.stringify(taskInputs));
          flowToken = taskResponse.data.flow_token;
          nextSubtask = taskResponse.data.subtasks[0].subtask_id;
          this.isLoggedIn = true;
        }
      }

      print.info("Getting Authentication Token...");
      const twitterAuthToken = taskResponse.headers.get('set-cookie')
        .find((x: string) => x.startsWith('auth_token='))
        .split('auth_token=')[1]
        .split(';')[0];
      print.info("Getting CSRF Token...");

      let csrfToken = taskResponse.headers
        .get('set-cookie')
        .find((x: string) => x.startsWith('ct0='))
        .split('ct0=')[1]
        .split(';')[0];

      this.setHeaders({ cookie: `auth_token=${twitterAuthToken}; ct0=${csrfToken}`, 'X-Csrf-Token': csrfToken });
      print.success("Login Success!");
    } catch (error) {
      throw error;
    }

    this.isLoggedIn = true;
  }

  private async checkUser() {
    // Ensures that the user is not suspended. Suspended users cannot access Twitter spaces;
    const response = (await getRequest(CONSTANTS.CHECK_USER_URL, this.headers)).data as { users: [{ is_suspended: boolean }] };
    const { is_suspended } = response.users[0];
    if (is_suspended) throw new Error(`@${this.options.username} is currently suspended`);
  }

  private async loginWithPuppeteer() {
    print.info(`Attempting to login with browser. Enter in your login details when browser launches`);
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: await this.getChromePath(),
      args: ["--disable-infobars", "--no-sandbox", "--disable-setuid-sandbox"]
    });
  
    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(120000); // 2 minutes
  
      // Enable request interception
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().includes('api.x.com') || request.url().includes('api.twitter.com')) {
          print.info(`API Request: ${request.url()}`);
        }
        request.continue();
      });
  
      // Navigate to the login page
      print.info('Navigating to login page...');
      await page.goto('https://x.com/i/flow/login', { waitUntil: 'networkidle0' });
  
      // Wait for login to complete
      print.info('Waiting for login to complete...');
      await Promise.race([
        print.info('Filling out username...'),
    
(async () => {
  try {
      // Fill out username
      await page.locator('input[name="text"]').fill(this.username);
      await page.locator('::-p-text(Next)').click();


      // Check if phone number verification is required
      const phoneNumberText = await page.evaluate(() => {
          const content = document.body.textContent?.toLowerCase() || '';
          return content.includes('phone');
      });

      if (phoneNumberText) {
          print.info('Phone number verification detected...');
          
          // Fill in phone number
          await page.locator('input[name="text"]').fill(this.phoneNumber);
          print.info('Entered phone number');

          // Click Next
          await page.locator('::-p-text(Next)').click();
          print.info('Clicked Next after phone number');
          

      }


      
      // Fill password
      await page.locator('input[name="password"]').fill(this.password);
      print.info('Entered password');

      // Click Log in
      await page.locator('::-p-text(Log in)').click();
      print.info('Clicked Log in button');

      // Wait for navigation to complete
      await page.waitForNavigation({ waitUntil: 'networkidle0' });

  } catch (error: any) {
      print.error(`Login error: ${error.message}`);
      throw error;
  }
})(),

    
        // Wait for navigation to finish
        await page.waitForNavigation({ waitUntil: "load" }),
    
        // Timeout catch, if login takes more than 120 seconds
        new Promise((_, reject) => setTimeout(() => reject(new Error('Login timeout')), 120000))
    ]);
  
      print.info('Login process completed. Extracting cookies...');
  
      // Get all cookies
      const cookies = await page.cookies();
  
      // Extract specific cookie values
      const auth_token = cookies.find(cookie => cookie.name === 'auth_token');
      const ct0 = cookies.find(cookie => cookie.name === 'ct0');
      const twid = cookies.find(cookie => cookie.name === 'twid');
  
      if (!auth_token || !ct0 || !twid) {
        throw new Error('Required cookies not found');
      }
  
      // Set headers with the new cookies
      this.setHeaders({
        cookie: `auth_token=${auth_token.value}; ct0=${ct0.value}; twid=${twid.value}`,
        'x-csrf-token': ct0.value
      });
  
      print.success("Login Success!");
  
      // Verify login by making a test API call
      await this.verifyLogin();
  
    } catch (error) {
      print.error(`Error during browser login: ${error}`);
      throw error;
    } finally {
      await browser.close();
    }
  }
  
  private async verifyLogin() {
    try {
      const response = await getRequest('https://api.x.com/1.1/account/verify_credentials.json', this.headers);
      if (response.status === 200) {
        print.success('Login verified successfully');
      } else {
        throw new Error(`Login verification failed with status ${response.status}`);
      }
    } catch (error) {
      print.error(`Login verification failed: ${error}`);
      throw error;
    }
  }

  private getChromePath() {
    const platform = os.platform();
    const arch = os.arch();

    switch (platform) {
      case 'win32':
        return arch === 'x64' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' :
          arch === 'x32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' :
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // Default to 64-bit path

      case 'darwin':
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

      case 'linux':
        return arch === 'arm' ? '/usr/bin/google-chrome' :
          '/usr/bin/google-chrome'; // Default to standard path

      default:
        throw new Error('Chrome not installed on your machine');
    }
  }

  private setHeaders(newHeaders: Partial<TaskHeaders>): void {
    this.headers = { ...this.headers, ...newHeaders };
  }

  private async getGuestToken(): Promise<string> {
    let scriptText = '';
    this.$('script').each((_: number, element: any) => {
      let text = this.$(element).html();
      if (text && text.includes('document.cookie')) {
        scriptText = text;
        return false; // Break the loop
      }
    });

    const stringWithGT: RegExpMatchArray | null = scriptText.match(/"gt=\d{19}/);
    if (stringWithGT && stringWithGT[0]) return stringWithGT[0].replace('"gt=', '');
    throw new Error('Failed to get guest token');
  }

  private async setSpaceMetadataAndMediaKey() {
    const variables = CONSTANTS.VARIABLES(this.id);
    const features = CONSTANTS.FEATURES;
    const { data } = (await getRequest(CONSTANTS.SPACE_METADATA_URL(variables, features), this.headers)).data;
    this.audioSpaceData = data.audioSpace;
    print.info('Retrieving media key...');
    this.mediaKey = this.audioSpaceData.metadata.media_key;
  }

  private async getPlaylist() {
    let playlistPath: string = path.join(this.storagePath + "/" + "playlist.m3u8");
    let playlist: string;

    if (await fs.pathExists(playlistPath)) {
      print.info('M3U8 Playlist already downloaded!');
      return await fs.readFile(playlistPath, { encoding: "utf-8" });
    }

    print.info('Downloading playlist');
    playlist = (await getRequest(this.playlistUrl, this.headers)).data;
    await this.saveToDisk(playlist, `playlist.m3u8`);
    return playlist;
  }

  private parsePlaylist(): string[] {
    const parser = new m3u8Parser.Parser();
    parser.push(this.playlist);
    parser.end();
    return parser.manifest.segments.map((x: { uri: string }) => this.chunkBaseUrl + x.uri);
  }

  private async saveToDisk(data: string | Buffer, location: string) {
    await fs.outputFile(path.join(this.storagePath + '/' + location), data);
  }


  private async downloadSegments(
    chunksUrls: string[],
    retryCount: Record<string, number> = {},
    maxRetries: number = 10,
    message: string
  ): Promise<void> {

    // Check cache for the downloaded chunks

    for (let url of chunksUrls) {
      print.progress(this.downloadChunksCount, this.chunksUrls.length, message, "AUDIO");
      const chunkName = path.basename(url);
      const chunkStorageLocation: string = path.join('chunks', chunkName);
      this.emit('progress', Math.round((this.downloadChunksCount / this.chunksUrls.length) * 100));
      if (!retryCount[chunkName]) retryCount[chunkName] = 0;
      if (await fs.pathExists(path.resolve(this.storagePath + "/" + chunkStorageLocation))) {
        this.downloadChunksCount++;
        message = `Skipping ${chunkName}`;
      } else {
        try {
          const retryMessage: string = retryCount[chunkName] ? `[${retryCount[chunkName]}/${maxRetries}] ` : "";
          message = `${retryMessage}Downloading ${chunkName}`;
          const response = await axios.get(url, { responseType: 'arraybuffer' });
          this.downloadChunksCount++;
          await this.saveToDisk(Buffer.from(response.data), chunkStorageLocation);
        } catch (error: any) {
          if (retryCount[chunkName] >= maxRetries) {
            // console.log(error);
            throw new Error(`\nFailed to fetch chunk: ${chunkName}. Giving up after ${maxRetries} retries. \n${error.message}`);
          }
          if (axios.isAxiosError(error)) {
            retryCount[chunkName] += 1;
            return this.downloadSegments([url], retryCount, maxRetries, message);
          }
          throw new Error("Something went wrong. Try again!");
        }
      }
    }
  }
  private cleanTitle(title: string): string {
    // Cleaning up the title is essential, because some titles can have special characters or emojis that might make it difficult to save the file to the correct path or transfer the file.
    var pattern = /[^\w\s]/g;

    // Replace matched characters with '-'
    return title.replaceAll(pattern, '-');
  }
  private async convertSegmentsToMp3(): Promise<void> {
    await fs.ensureDir(path.join(this.storagePath, 'out'));
    const passThroughStream = new PassThrough();
    this.mp3OutputFilePath = path.join(this.storagePath, 'out', `${this.cleanTitle(this.audioSpaceData.metadata.title)}.mp3`);
    const chunks: string[] = await fs.readdir(path.join(this.storagePath, 'chunks'), { encoding: "utf-8" });
    if (chunks.length === 0) {
      throw new Error('Failed to fetch chunks saved on disk.');
    }
    for (const chunkPath of chunks) {
      passThroughStream.write(await fs.readFile(path.join(this.storagePath, 'chunks', chunkPath)));
    };
    const outputStream = fs.createWriteStream(this.mp3OutputFilePath);

    passThroughStream.end();
    await new Promise<void>((resolve, reject) => {
      ffmpeg(passThroughStream)
        .inputFormat('aac')
        .audioFrequency(44100)  // Set sample rate to 44.1 kHz for better quality
        .audioChannels(2)       // Set audio channels to stereo
        .audioCodec('libmp3lame') // Set audio codec to libmp3lame for MP3 encoding
        .toFormat('mp3')        // Set output format to mp3
        .on('error', (err) => {
          reject(`Error: ${err.message}`);
        })
        .on('progress', (progress) => {
          const duration: number = new Date(Number(this.audioSpaceData.metadata.ended_at) - this.audioSpaceData.metadata.started_at).getTime();
          const datedTimeStamp: number = new Date(`1970-01-01T${progress.timemark}Z`).getTime();
          print.progress(datedTimeStamp, duration, "Combining chunks and converting to .mp3", "FFMPEG");
        })
        .on('end', () => {
          resolve();
          print.success('Merging completed');
        })
        .stream(outputStream);
    });
  }

  async generateAudio() {
    this.playlist = await this.getPlaylist();
    this.chunksUrls = this.parsePlaylist();
    if (await fs.pathExists(path.join(this.storagePath, '/', 'chunks'))) print.info("Resuming audio chunks download...");
    else print.info('Starting to download audio chunks...');
    await this.downloadSegments(this.chunksUrls, {}, 10, 'Initializing');
    await this.convertSegmentsToMp3()
    return this;
    // if (this.downloadChunksCount === this.chunksUrls.length) await this.convertSegmentsToMp3();
  }

  cleanup() {
    print.info("Cleaning up!");
    const finalFilePath = path.resolve(this.mp3OutputFilePath, '../../..', path.basename(this.mp3OutputFilePath));
    fs.moveSync(this.mp3OutputFilePath, finalFilePath);
    print.info(`Output file written to: ${finalFilePath}`);
    fs.rmSync(this.storagePath, { recursive: true, force: true });
    print.success("Done!");
  }
}
