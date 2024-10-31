    import { Command } from 'commander';
    import { Downloader } from '../index.js';
    import { DownloaderOptions } from '../types.js';
    import { print } from '../utils/utils.js';
    const program = new Command();


    program
        .name('spaces-dl')
        .description('CLI to download recorded Twitter Spaces')
        .version('1.0.5')
        .option('-i, --id <id>', 'A valid ID for a recorded Twitter Space')
        .option('-o, --output <path>', 'Output path for the recorded audio/video')
        .option('-d, --disable-browser-login', 'Disable logging in with the browser if logging in with username and password fails')
        .option('-b, --browser-login', 'Login with a browser instead (great for privacy)')
        .action((options) => {
            if (!options.id) {
                print.error("Error: --id option required");
                process.exit(1);
            }
        });

    program.parse(process.argv);

    const options: DownloaderOptions = program.opts();

    try {
        let task: Downloader;
        if (!options.output) options.output = process.cwd();
        task = new Downloader(options);  // Initialize downloader

        // Run task and handle cleanup
        task.init()
            .then(() => task.generateAudio())
            .then(() => task.cleanup())
            .then(() => {
                print.success('Process finished successfully!');
                process.exit(0);  // Exit CLI with a success code after everything is complete
            })
            .catch((error: any) => {
                print.error(`Error: ${error}`);
                process.exit(1);  // Exit with a failure code (1) if anything goes wrong
            });

    } catch (error: any) {
        print.error(error);
        process.exit(1);  // Exit with failure if top-level error occurs
    }