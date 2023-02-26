import tl = require('azure-pipelines-task-lib/task');
import { DependencyCheckOptions } from "./dependency-check-options";
import { DCConst } from './dependency-check-constants';

export class DependencyCheckOptionsBuilder {

    private defaultRootFolder: string;
    private defaultExportDirectory: string;
    private defaultLogFilePath: string;

    private _exportDirectory: string;
    private _isVerboseEnabled: boolean = false;
    private _isUpdateOnlyEnabled: boolean = false;
    private _logFilePath: string;


    public get exportDirectory(): string {
        return this._exportDirectory;
    }

    public get isVerboseEnabled(): boolean {
        return this._isVerboseEnabled;
    }
    
    public get isUpdateOnlyEnabled(): boolean {
        return this._isUpdateOnlyEnabled;
    }

    public get logFilePath(): string {
        return this._logFilePath;
    }


    constructor() {
        this.defaultRootFolder = tl.getVariable("Build.ArtifactStagingDirectory") || "./";
        this.defaultExportDirectory = tl.resolve(this.defaultRootFolder, DCConst.DependencyCheckFolderName);
        this.defaultLogFilePath = tl.resolve(this.defaultExportDirectory, DCConst.DependencyCheckFolderName, "dependency-check-log.txt");

        this._exportDirectory = this.defaultExportDirectory;
        this._logFilePath = this.defaultLogFilePath;
    }


    /**
     * The export directory path to store the Dependency Check ZIP file to. 
     * @param value The export directory path, if `undefined` or `null`, reset to default value (`$BUILD_ARTIFACTSTAGINGDIRECTORY\dependency-check`).
     * @returns The current builder instance.
     */
    public setExportDirectory(value: string | undefined): DependencyCheckOptionsBuilder {
        this._exportDirectory = value?.trim() || this.defaultExportDirectory;
        return this;
    }  

    public setIsVerboseEnabled(value: boolean): DependencyCheckOptionsBuilder {
        this._isVerboseEnabled = value;
        return this;
    }    
    
    public setIsUpdateOnlyEnabled(value: boolean): DependencyCheckOptionsBuilder {
        this._isUpdateOnlyEnabled = value;
        return this;
    }

    /**
     * The full log file path.
     * @param value The log file path, if `undefined` or `null`, reset to default value (`$BUILD_ARTIFACTSTAGINGDIRECTORY\dependency-check\dependency-check-log.txt`).
     * @returns The current builder instance.
     */
    public setLogFilePath(value: string): DependencyCheckOptionsBuilder {
        this._logFilePath = value;
        return this;
    }


    public build(): DependencyCheckOptions {

        return new DependencyCheckOptions(this);
    }
}