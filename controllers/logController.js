const objectsToCsv =  require("objects-to-csv");
const utils =         require('./../utils/utils');
const SEMAPHORE_log = require('semaphore')(1);
const fs =            require('fs');
const getFolderSize = require('fast-folder-size/sync');
const env =           require('dotenv').config().parsed;

class Log {
    constructor() {
        this.objectsToCsvInstance = new objectsToCsv([{}]);
        Log.instance = null;
    }

    async save(dataToLog, logType) {
        SEMAPHORE_log.take(async () => {

            // create log according to log type
            let logFile;
            switch (logType) {

                case 'info':
                    logFile = "./logs/info/log_info.csv";
                    this.objectsToCsvInstance.data[0].dateStamp = utils.getDateStamp();
                    this.objectsToCsvInstance.data[0].data =      (typeof dataToLog === 'object') ? JSON.stringify(dataToLog) : dataToLog.replace(/[\n]/g, '  ');
                    break

                case 'error':
                    logFile = "./logs/error/log_error.csv";
                    this.objectsToCsvInstance.data[0].dateStamp =    utils.getDateStamp();
                    this.objectsToCsvInstance.data[0].data =         (typeof dataToLog.data === 'object')          ? JSON.stringify(dataToLog.data)         : dataToLog.data;
                    this.objectsToCsvInstance.data[0].errorMessage = ((typeof dataToLog.errorMessage === 'object') ? JSON.stringify(dataToLog.errorMessage) : dataToLog.errorMessage).replace(/[\n]/g, '  ');
                    this.objectsToCsvInstance.data[0].from =         (typeof dataToLog.from === 'object')          ? dataToLog.from.toString()              : dataToLog.from;
                    break

                case 'incomingTelegramMessages':
                    logFile = "./logs/incomingTelegramMessages/log_incomingTelegramMessages.csv";
                    this.objectsToCsvInstance.data[0].dateStamp = utils.getDateStamp();
                    this.objectsToCsvInstance.data[0].from =      dataToLog.from;
                    this.objectsToCsvInstance.data[0].command =   dataToLog.command;
                    break

                case 'profits':
                    logFile = "./logs/profits/log_profit.csv";
                    this.objectsToCsvInstance.data[0].dateStamp =   utils.getDateStamp();
                    this.objectsToCsvInstance.data[0].profit =      dataToLog.profit;
                    this.objectsToCsvInstance.data[0].waitingTime = dataToLog.waitingTime;
                    this.objectsToCsvInstance.data[0].symbol =      dataToLog.symbol;
                    break
            }

            // create logs folders if they don't exist
            if(!fs.existsSync('logs')){                          await fs.mkdirSync('logs')}
            if(!fs.existsSync('logs/info')){                     await fs.mkdirSync('logs/info')}
            if(!fs.existsSync('logs/profits')){                  await fs.mkdirSync('logs/profits')}
            if(!fs.existsSync('logs/error')){                    await fs.mkdirSync('logs/error')}
            if(!fs.existsSync('logs/incomingTelegramMessages')){ await fs.mkdirSync('logs/incomingTelegramMessages')}

            // save to log's csv file
            await this.objectsToCsvInstance.toDisk(logFile, { append: true})
                .then(() => {
                    this.cleanObjectsToCsvInstance();
                    SEMAPHORE_log.leave();
                })
                .catch((error) => {
                    console.log( "Error guardando log  :  \n"+ JSON.stringify(this.objectsToCsvInstance.data[0]) +"\nError details  :  " + (error.hasOwnProperty('stack') ? error.stack : error) );
                    this.cleanObjectsToCsvInstance();
                    SEMAPHORE_log.leave();
                });
        });
    }

    async rotateLogs(){
        return new Promise(async (resolve, reject) => {
            SEMAPHORE_log.take(async () => {
                SEMAPHORE_log.leave();
                let logs= {filesInFolder: {}, fileSize: {}};

                try{ logs.logsFolderSize =                         getFolderSize('./logs')/(1000*1000) }                      catch(error){ logs.logsFolderSize =                         undefined }
                try{ logs.filesInFolder.info =                     fs.readdirSync('./logs/info').length }                     catch(error){ logs.filesInFolder.info =                     undefined }
                try{ logs.filesInFolder.profits =                  fs.readdirSync('./logs/profits').length }                  catch(error){ logs.filesInFolder.profits =                  undefined }
                try{ logs.filesInFolder.error =                    fs.readdirSync('./logs/error').length }                    catch(error){ logs.filesInFolder.error =                    undefined }
                try{ logs.filesInFolder.incomingTelegramMessages = fs.readdirSync('./logs/incomingTelegramMessages').length } catch(error){ logs.filesInFolder.incomingTelegramMessages = undefined }
                try{ logs.fileSize.info =                     (await fs.statSync('./logs/info/log_info.csv')).size/(1000*1000)                                         }catch(error){logs.fileSize.info =                     undefined}
                try{ logs.fileSize.profits =                  (await fs.statSync('./logs/profits/log_profits.csv')).size/(1000*1000)                                   }catch(error){logs.fileSize.profits =                  undefined}
                try{ logs.fileSize.error =                    (await fs.statSync('./logs/error/log_error.csv')).size/(1000*1000)                                       }catch(error){logs.fileSize.error =                    undefined}
                try{ logs.fileSize.incomingTelegramMessages = (await fs.statSync('./logs/incomingTelegramMessages/log_incomingTelegramMessages.csv')).size/(1000*1000) }catch(error){logs.fileSize.incomingTelegramMessages = undefined}

                // if a log file size in greater than 10 MB... rotate this log
                // then... if logs folder size is greater than 2 GB... erase oldest logFile from folder with more logFiles
                await this.renameLogFilesGreaterThanSpecified(logs)
                    .then(async (response) => {

                        if(!response.hasOwnProperty('redirectedError')){

                            await this.eraseOldestLogFileFromFolderWithMoreLogFiles(logs)
                                .then((response) => {
                                    if(!response.hasOwnProperty('redirectedError')){
                                        resolve(response);
                                    }
                                    else{
                                        reject(response);
                                    }
                                });
                        }
                        else{
                            reject(response);
                        }
                    })
            })
        })
    }

    cleanObjectsToCsvInstance(){
        this.objectsToCsvInstance.data[0] = {};
    }

    renameLogFilesGreaterThanSpecified(logs){
        return new Promise(async (resolve) => {
            let logFileSizeArray = Object.entries(logs.fileSize);
            (logFileSizeArray.length === 0) ? resolve(true) : null;
            for (let i = 0; i < logFileSizeArray.length; i++){
                try{
                    if(logFileSizeArray[i][1]  &&  logFileSizeArray[i][1] > parseInt(env.logs_maxSizeOfEachLogFileInMB)){
                        await fs.renameSync('./logs/'+logFileSizeArray[i][0]+'/log_'+logFileSizeArray[i][0]+'.csv', ('./logs/'+logFileSizeArray[i][0]+'/log_'+logFileSizeArray[i][0]+'__'+utils.getDateStamp() +'.csv').replace(/[:]/g,'.'));
                    }
                    // if this is the last logFile, being analyzed
                    if(i+1 === logFileSizeArray.length){
                        resolve(true);
                    }
                }
                catch (error) {
                    resolve({
                        data:            null,
                        redirectedError: false,
                        errorMessage:    "error rotating "+logFileSizeArray[0],
                        from:            "logController -> rotateLogs -> if a log file size in greater than 10 MB... rotate this log"
                    });
                }
            }
        })
    }

    eraseOldestLogFileFromFolderWithMoreLogFiles(logs){
        return new Promise(async (resolve) => {
            let folderWithMoreFiles = {folder:"", files:0};
            let oldestFile;

            // checks if logs folder size is greater than 2000 MB
            if(logs.logsFolderSize  &&  logs.logsFolderSize > parseInt(env.logs_maxSizeOfLogsFolderInMB)){

                // identify folder with more files
                for (let filesInFolder of Object.entries(logs.filesInFolder)) {
                    if(filesInFolder[1] > folderWithMoreFiles.files){
                        folderWithMoreFiles.folder = filesInFolder[0];
                        folderWithMoreFiles.files =  filesInFolder[1];
                    }
                }

                // erase oldest file from this folder
                try{
                    oldestFile = fs.readdirSync('./logs/'+folderWithMoreFiles.folder);
                    oldestFile = oldestFile[oldestFile.length -1]
                    await fs.unlinkSync("./logs/"+folderWithMoreFiles.folder+"/"+oldestFile);

                    resolve(true);
                }
                catch (error) {
                    resolve({
                        data:            null,
                        redirectedError: false,
                        errorMessage:    "error erasing "+oldestFile+" from folder "+folderWithMoreFiles.folder,
                        from:            "logController -> rotateLogs -> eraseOldestLogFromFolderWithMoreLogs"
                    });
                }
            }
            else{
                resolve(true);
            }
        })
    }

    static getInstance(){
        if (!Log.instance) {
            Log.instance = new Log();
        }
        return Log.instance;
    }
}

module.exports = Log;