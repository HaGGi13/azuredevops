import tl = require('azure-pipelines-task-lib/task');
import httpClient = require('typed-rest-client/HttpClient');
import fs = require('fs');
import path = require("path");
import Zip from "adm-zip";
import { IHttpClientResponse } from 'typed-rest-client/Interfaces';

import { DCConst } from './dependency-check-constants';
import { DependencyCheckOptions } from './dependency-check-options';
import { DependencyCheckOptionsBuilder } from './dependency-check-options-builder';


const client = new httpClient.HttpClient('DC_AGENT');


/*
 * NOTE:
 * 
 * Azure DevOps Server/Services defines all not set input path as Build.SourcesDirectory.
 * 
 * Therefore, tl.getPathInput('localInstallPath') == tl.getVariable('Build.SourcesDirectory'), 
 * if localInstallPath was not defined.
 */



/**
 * The execution entry point.
 */
async function run() {

    console.log("Starting Dependency Check download...")

    try {
        // Input parameters
        const customRepoUrl: string | undefined = tl.getInput('customRepoUrl')?.trim();
        const dependencyCheckVersion: string | undefined = (tl.getInput('dependencyCheckVersion') || DCConst.DependencyCheckVersionLatest)?.trim();
        const enableVerbose: boolean = tl.getBoolInput("enableVerbose");
        let localInstallPath: string | undefined = tl.getPathInput('localInstallPath')?.trim();
        let logDirectory: string | undefined = tl.getPathInput("logDirectory")?.trim();
        let exportDirectory: string | undefined = tl.getPathInput("exportDirectory")?.trim();

        // Environment variable
        const sourcesDirectory: string | undefined = tl.getVariable("Build.SourcesDirectory");
        const artifactDirectory: string | undefined = tl.getVariable("Build.ArtifactStagingDirectory");
        
        let hasLocalInstallation: boolean = true;



        // Set log directory (if necessary)
        if (logDirectory == sourcesDirectory) {
            logDirectory = tl.resolve(artifactDirectory, DCConst.DependencyCheckFolderName);
        }
        console.log(`Setting log directory to ${logDirectory}`);
        // Create log directory (if necessary)
        if (!tl.exist(logDirectory!)) {
            console.log(`Creating log directory at ${logDirectory}`);
            tl.mkdirP(logDirectory!);
        }

        // Set export directory (if necessary)
        if (exportDirectory == sourcesDirectory) {
            exportDirectory = tl.resolve(artifactDirectory, DCConst.DependencyCheckFolderName);
        }
        console.log(`Setting export directory to ${exportDirectory}`);
        // Create export directory (if necessary)
        if (!tl.exist(exportDirectory!)) {
            console.log(`Creating export directory at ${exportDirectory}`);
            tl.mkdirP(exportDirectory!);
        }

        // Set logs file
        let logFile = tl.resolve(logDirectory, 'dependency-check-log.txt');

        var options = new DependencyCheckOptionsBuilder()
            .setExportDirectory(exportDirectory)
            .setIsUpdateOnlyEnabled(true)
            .setIsVerboseEnabled(enableVerbose)
            .setLogFilePath(logFile)
            .build();

        if (!isVersionFormatValid(dependencyCheckVersion)) {
            throw new Error(`Invalid Dependency Check version format '${dependencyCheckVersion}'.`);
        }

        // if localInstallPath is not set, it's sources directory path by default
        if (localInstallPath == sourcesDirectory) {
            hasLocalInstallation = false;
            // set to '$(Build.SourcesDirectory)/dependency-check'
            localInstallPath = tl.resolve('.', DCConst.DependencyCheckFolderName);
            // create directory, if not exist already
            tl.mkdirP(localInstallPath);
            
            let installZipUrl: string;
            if (customRepoUrl) {
                console.log(`Downloading Dependency Check installer from ${customRepoUrl}...`);
                installZipUrl = customRepoUrl;
            } else {
                console.log(`Downloading Dependency Check ${dependencyCheckVersion} installer from GitHub...`);
                installZipUrl = await getDependencyCheckDownloadUrl(dependencyCheckVersion);
            }

            cleanDirectory(localInstallPath, ['**', '!data', '!data/**']);
            await unzipFromUrl(installZipUrl, tl.resolve('./'));

            await updateDependencyCheckData(localInstallPath, hasLocalInstallation, options);
        } else if (localInstallPath) {
            // local installation path was defined, so it must exist
            tl.checkPath(localInstallPath, "Dependency Check installer");
        }
    }
    catch (err: any) {
        console.log(err.message);
        tl.setResult(tl.TaskResult.Failed, err.message, true);
    }

    console.log("Ending Dependency Check download...")
}

/**
 * Validates if a version has a valid format. Valid is 'x.y.z' or 'latest'.
 * @param {string} version The version string to validate.
 * @returns {boolean} `true` if valid; otherwise `false`
 */
function isVersionFormatValid(version: string): boolean {

    const versionPattern: string = `^(\d\.\d\.\d|${DCConst.DependencyCheckVersionLatest})$`;

    const versionRegex = new RegExp(versionPattern, 'gi');

    return versionRegex.test(version);
}

/**
  * Returns the download URL of the OWASP Dependency Check installation package in defined version.
 * @param {string} version The package version to download
 * @returns {string} The package download URL.
 */
async function getDependencyCheckDownloadUrl(version: string): Promise<string> {

    logDebug('Determine GitHub package URL...')

    let url = `${DCConst.DependencyCheckReleaseApi}/tags/v${version}`;

    if (version.toLowerCase() == DCConst.DependencyCheckVersionLatest) {
        url = `${DCConst.DependencyCheckReleaseApi}/${DCConst.DependencyCheckVersionLatest}`;
    }

    let response = await client.get(url);
    let releaseInfo = JSON.parse(await response.readBody());
    let asset = releaseInfo['assets'].find((asset: { [x: string]: string; }) => asset['content_type'] == 'application/zip');

    let packageUrl = asset['browser_download_url'];

    logDebug(`Determined GitHub package URL: ${packageUrl}`);

    return packageUrl;
}


/**
 * Deletes all files and folders out of a specified root path recursively, based on defined patterns.
 * Performs the find and then applies the glob patterns. Supports interleaved exclude patterns.
 * @param {string} path The directory to clean up.
 * @param {string | string[]} patterns The search patterns to apply.
 */
function cleanDirectory(path: string, patterns: string|string[]) {

    let files = tl.findMatch(path, patterns);
    files.forEach(file => tl.rmRF(file));
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
 * @returns {boolean} `true` if in debug mode; otherwise `false`
 */
function isSystemDebugEnabled(): boolean {

    let varSystemDebug = tl.getVariable('system.debug');

    return typeof varSystemDebug === 'string'
        && varSystemDebug.toLowerCase() == 'true';
}

/**
 * Determines the agent Operating System depending OWASP Dependency Check script full file path to execute.
 * @param {string} dependencyCheckDir Dependency Check directory path.
 * @returns {string} The OS specific script file path.
 */
async function getDependencyCheckScriptPath(dependencyCheckDir: string): Promise<string> {

    // Get dependency check script path (.sh file for Linux and Darwin OS)
    let osSpecificDependencyCheckScript = tl.getPlatform() == tl.Platform.Windows
        ? 'dependency-check.bat'
        : 'dependency-check.sh';

    let dependencyCheckScriptPath = tl.resolve(dependencyCheckDir, 'bin', osSpecificDependencyCheckScript);

    console.log(`Dependency Check script set to ${dependencyCheckScriptPath}`);

    tl.checkPath(dependencyCheckScriptPath, 'Dependency Check script');

    return dependencyCheckScriptPath;
}

/**
 * Remove lock files from potential previous canceled run if no local/centralized installation of tool is used.
 * We need this because due to a bug the dependency check tool is currently leaving `.lock` files around if you cancel at the wrong moment.
 * Since a per-agent installation shouldn't be able to run two scans parallel, we can safely remove all lock files still lying around.
 * @param {string} dependencyCheckDir Dependency Check directory path.
 */
function removeLockFile(dependencyCheckDir: string) {

    console.log('Searching for left over lock files...');

    let lockFiles = tl.findMatch(dependencyCheckDir, '*.lock', undefined, { matchBase: true });

    if (lockFiles.length > 0) {

        console.log('found ' + lockFiles.length + ' left over lock files, removing them now...');

        lockFiles.forEach(lockfile => {
            let fullLockFilePath = tl.resolve(lockfile);

            try {
                if (tl.exist(fullLockFilePath)) {
                    console.log('removing lock file "' + fullLockFilePath + '"...');
                    tl.rmRF(fullLockFilePath);
                }
                else {
                    console.log('found lock file "' + fullLockFilePath + '" doesn\'t exist, that was unexpected');
                }
            }
            catch (err) {
                console.log('could not delete lock file "' + fullLockFilePath + '"!');
                console.error(err);
            }
        });
    }
    else {
        console.log('found no left over lock files, continuing...');
    }
}

/**
 * 
 * @param {string} scriptPath OS specific Dependency Check script file path to execute.
 * @param {string} args The arguments to pass to the to execute script.
 * @returns {number} The Dependency Check exit code.
 */
async function runDependencyCheck(scriptPath: string, args: string): Promise<number> {

    let exitCode = await tl.tool(scriptPath).line(args).exec({
        failOnStdErr: false,
        ignoreReturnCode: true
    });

    console.log(`Dependency Check completed with exit code ${exitCode}.`);

    return exitCode;
}

/**
 * Executes the update phase of Dependency Check only,
 * no scan will be executed and no report will be generated. If enabled a log file is written.
 * @param {string} dependencyCheckDir Dependency Check directory path.
 * @param {boolean} hasLocalInstallation Defines if Dependency Check is installed locally on agent.
 * @param {DependencyCheckOptions} dcOptions The execution options for the Dependency Check.
 */
async function updateDependencyCheckData(dependencyCheckDir: string, hasLocalInstallation: boolean, dcOptions: DependencyCheckOptions) {

    let dependencyCheckScriptPath: string = await getDependencyCheckScriptPath(dependencyCheckDir);

    let args = dcOptions.getExecutableArguments();

    // Console output for the log file
    console.log('Invoking Dependency Check data update...');
    console.log(`Path: ${dependencyCheckScriptPath}`);
    console.log(`Arguments: ${args}`);

    // Set Java args
    tl.setVariable('JAVA_OPTS', '-Xss8192k');

    // Version smoke test
    await tl.tool(dependencyCheckScriptPath).arg(dcOptions.cliArguments.Version).exec();
    
    if (!hasLocalInstallation) {
        removeLockFile(dependencyCheckDir);
    }

    let exitCode = await runDependencyCheck(dependencyCheckScriptPath, args);
}


run();
