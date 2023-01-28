import tl = require('azure-pipelines-task-lib/task');
import httpClient = require('typed-rest-client/HttpClient');
import fs = require('fs');
import path = require("path");
import Zip from "adm-zip";
import { IHttpClientResponse } from 'typed-rest-client/Interfaces';

const client = new httpClient.HttpClient('DC_AGENT');

const releaseApi = 'https://api.github.com/repos/jeremylong/DependencyCheck/releases';
const dependencyCheckVersionLatest:string = 'latest';


async function run() {

    console.log("Starting Dependency Check download...")

    try {
        // Input parameters
        const dependencyCheckVersion: string | undefined = (tl.getInput('dependencyCheckVersion') || dependencyCheckVersionLatest)?.trim();
        let localInstallPath: string | undefined = tl.getPathInput('localInstallPath')?.trim();
        const customRepoUrl: string | undefined = tl.getInput('customRepoUrl')?.trim();

        // Environment variable
        let sourcesDirectory = tl.getVariable('Build.SourcesDirectory');


        if (!isVersionFormatValid(dependencyCheckVersion)) {
            throw new Error(`Invalid Dependency Check version format '${dependencyCheckVersion}'.`);
        }

        // Set local installation path
        if (localInstallPath == sourcesDirectory) {
            
            localInstallPath = tl.resolve('./dependency-check');

            tl.checkPath(localInstallPath, 'Dependency Check installer');
            
            let installZipUrl: string;
            if (customRepoUrl) {
                console.log(`Downloading Dependency Check installer from ${customRepoUrl}...`);
                installZipUrl = customRepoUrl;
            }
            else {
                console.log(`Downloading Dependency Check ${dependencyCheckVersion} installer from GitHub...`);
                installZipUrl = await getDependencyCheckDownloadUrl(dependencyCheckVersion);
            }

            cleanDirectory(localInstallPath, ['**', '!data', '!data/**']);
            await unzipFromUrl(installZipUrl, tl.resolve('./'));
        }
    }
    catch (err: any) {
        console.log(err.message);
        tl.setResult(tl.TaskResult.Failed, err.message, true);
    }

    console.log("Ending Dependency Check download...")
}


/**
 * Deletes all files and folders out of a specified root path recursively, based on defined patterns.
 * Performs the find and then applies the glob patterns. Supports interleaved exclude patterns.
 * @param {string} path The directory to clean up.
 * @param {string | string[]} patterns The search patterns to apply.
 */
function cleanDirectory(path: string, patterns:string|string[]) {

    let files = tl.findMatch(path, patterns);
    files.forEach(file => tl.rmRF(file));
}

/**
 * Returns the download URL of the OWASP Dependency Check installation package in defined version.
 * @param {string} version The package version to download
 * @returns The package download URL.
 */
async function getDependencyCheckDownloadUrl(version: string): Promise<string> {

    logDebug('Determine GitHub package URL...')

    let url = `${releaseApi}/tags/v${version}`;

    if (version.toLowerCase() == dependencyCheckVersionLatest) {
        url = `${releaseApi}/${dependencyCheckVersionLatest}`;
    }

    let response = await client.get(url);
    let releaseInfo = JSON.parse(await response.readBody());
    let asset = releaseInfo['assets'].find((asset: { [x: string]: string; }) => asset['content_type'] == 'application/zip');

    let packageUrl = asset['browser_download_url'];

    logDebug(`Determined GitHub package URL: ${packageUrl}`);

    return packageUrl;
}

/**
 * Downloads a file from an URL and stores it in the file system.
 * @param {string} url The URL to download the file from.
 * @returns {string} The path of downloaded file in file system.
 */
async function downloadPackage(url: string): Promise<string> {

    let fileName = path.basename(new URL(url).pathname);
    let installPackage = tl.resolve(fileName)
    let tmpError = null;
    let downloadErrorRetries = 5;
    let response: IHttpClientResponse;

    do {
        tmpError = null;

        try {
            console.log('Downloading ZIP from "' + url + '"...');
            response = await client.get(url);
            logDebug('done downloading');
        }
        catch(error) {
            tmpError = error;
            downloadErrorRetries--;
            console.error('Error trying to download ZIP (' + (downloadErrorRetries + 1) + ' tries left)');
            console.error(error);
        }
    }
    while(tmpError !== null && downloadErrorRetries >= 0);
    
    if(tmpError !== null) {
        throw tmpError;
    }

    logDebug('Download was successful, saving downloaded ZIP file...');

    await new Promise<void>(function (resolve, reject) {
        let writer = fs.createWriteStream(installPackage);
        writer.on('error', err => reject(err));
        writer.on('finish', () => resolve());
        response.message.pipe(writer);
    });

    logDebug('Downloaded ZIP file has been saved.');

    return installPackage;
}

/**
 * Downloads a ZIP file from an URL and extracts it into a specified path.
 * @param {string} zipUrl The URL to download the ZIP file from.
 * @param {string} unzipLocation The path to extract the ZIP file to.
 */
async function unzipFromUrl(zipUrl: string, unzipLocation: string): Promise<void> {

    let installZipPath: string = await downloadPackage(zipUrl);

    await unzipFileTo(installZipPath, unzipLocation);

    await logDebug('Unzipping complete, removing ZIP file now...');

    tl.rmRF(installZipPath);

    await logDebug('ZIP file has been removed');
}

/**
 * Unzips a file into a target path.
 * @param {string} filePath The path of the zip file to extract.
 * @param {string} targetPath The target path to unzip the zip file to.
 */
async function unzipFileTo(filePath: string, targetPath: string): Promise<void> {

    console.log(`Extracting '${filePath}' to '${targetPath}'`);

    try {
        let zipFile = new Zip(filePath);
        zipFile.extractAllTo(targetPath, true);
        console.log(`Extracted '${filePath}' to '${targetPath}' successfully`);
    } catch (error) {
        console.error(`Extracting '${filePath}' failed`);
    }
}

/**
 * Logs a pipeline debug message, if debug mode is enabled.
 * @param {string} message The message to log
 */
function logDebug(message: string) {

    if (message !== null && isSystemDebugEnabled()) {
        console.log('##[debug]' + message);
    }
}

/**
 * Checks if the pipelines is executed in debug mode.
 * @returns {boolean} true if in debug mode; otherwise false
 */
function isSystemDebugEnabled(): boolean {

    let varSystemDebug = tl.getVariable('system.debug');

    return typeof varSystemDebug === 'string'
        && varSystemDebug.toLowerCase() == 'true';
}

/**
 * Validates if a version has a valid format. Valid is 'x.y.z' or 'latest'.
 * @param {string} version The version string to validate.
 * @returns true if valid; otherwise false
 */
function isVersionFormatValid(version: string): boolean {

    const versionPattern: string = `^(\d\.\d\.\d|${dependencyCheckVersionLatest})$`;

    const versionRegex = new RegExp(versionPattern, 'gi');

    return versionRegex.test(version);
}


run();
