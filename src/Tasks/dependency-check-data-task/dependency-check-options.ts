import { DependencyCheckOptionsBuilder } from "./dependency-check-options-builder";

/**
 * Dependency Check execution arguments.
 */
export class DependencyCheckOptions {

    
    cliArguments = Object.freeze({
        LogFile: "--log",
        UpdateOnly: "--updateonly",
        Version: "--version"
    });


    private _exportDirectory: string;
    private _isUpdateOnlyEnabled: boolean;
    private _isVerboseEnabled: boolean;
    private _logFilePath: string;


    /**
     * The folder to export the Dependency Check data ZIP file to.
     * @returns {string} The export directory full path.
     */
    public get exportDirectory(): string {
        return this._exportDirectory;
    }

    /**
     * Execute Dependency Check in update data/definitions mode, no scan will be executed.
     * @returns {boolean} `true` if update data only is enabled; otherwise `false`
     */
    public get isUpdateOnlyEnabled(): boolean {
        return this._isUpdateOnlyEnabled;
    }

    /**
     * Enable verbose logging.
     * @returns {boolean} `true` if verbose logging is enabled; otherwise `false`
     */
    public get isVerboseEnabled(): boolean {
        return this._isVerboseEnabled;
    }

    /**
     * The full file path of the log file.
     * @returns {string} Log files full file path.
     */
    public get logFilePath(): string {
        return this._logFilePath;
    }

    /**
     * Initializes a Dependency Check options object.
     * @param isVerboseEnabled Defines if verbose logging is dis-/enabled.
     * @param logFilePath The log files full path.
     */
    constructor(builder: DependencyCheckOptionsBuilder) {
        this._exportDirectory = builder.exportDirectory;
        this._isUpdateOnlyEnabled = builder.isVerboseEnabled;
        this._isVerboseEnabled = builder.isVerboseEnabled;
        this._logFilePath = builder.logFilePath;
    }


    getExecutableArguments(): string {

        let args: string = this.cliArguments.UpdateOnly;

        if (this.isVerboseEnabled) {
            args += ` ${this.cliArguments.LogFile} ${this.logFilePath}`
        }

        return args;
    }
}