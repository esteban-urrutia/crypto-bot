const env =                      require('dotenv').config().parsed
const log =                      require('./controllers/logController').getInstance();
const CRON_rotateLogs =          require('node-cron');
const CRON_trade =               require('node-cron');
const CRON_internetCheck =       require('node-cron');
const telegramController =       require("./controllers/telegramController");
const secondaryTasksController = require("./controllers/secondaryTasksController");
const TelegramBot =              require('node-telegram-bot-api');
const tradeController_trade =    require("./controllers/tradeController/trade");
const miniDBcontroller =         require("./controllers/miniDBcontroller");
const utils =                    require("./utils/utils");
const SEMAPHORE_miniDB =         require('semaphore')(1);
let   telegram =                 (env.telegram_enabled === 'true') ? new TelegramBot(env.telegram_token, { polling: true }) : null;
let   internetStatus =           null;
let   apiErrorHandlerCounter =   0;


// boot notification
telegramController.sendMessage(telegram, "Service Started", "text")
    .catch(async (telegramError) => {
        await log.save(telegramError, "error");
    })


//---------------------------------TRADING--------------------------------
// scheduler that trade fiat-asset
CRON_trade.schedule(env.trade_frecuency, async () => {

    await tradeController_trade.trade(telegram, SEMAPHORE_miniDB)
        .then(async (info) => {
            apiErrorHandlerCounter = 0;
            if(info){
                await log.save(info, "info");
            }
        })
        .catch(async (error) => {
            await log.save(error, "error");

            if(!error.hasOwnProperty('alertSent')){

                if(error.from === "utils -> apiErrorHandler"){
                    apiErrorHandlerCounter = 1 + apiErrorHandlerCounter;

                    // if error code is 418(ipBanned) or 429 (ipBanWarning)... stop trading until specified timeStamp
                    if(error.hasOwnProperty("statusCode")                        &&
                        (error.statusCode === 418  ||  error.statusCode === 429)  ){

                        let ipBanReceived = Math.ceil(error.errorMessage.slice(39, 52)/1000);

                        await miniDBcontroller.updateMiniDB(SEMAPHORE_miniDB, "ipBanUntil", ipBanReceived)
                            .then(async () => {

                                await telegramController.sendMessage(telegram, "IP banned (weightPerMinute: 186)\n\nTrading will be disabled until:\n"+utils.getDateStampFromTimeStamp(ipBanReceived), "text")
                                    .catch(async (error) => {
                                        await log.save(error, "error");
                                    })
                            })
                            .catch(async (error) => {
                                await log.save(error, "error");
                            })
                    }

                    // if this is the third consecutive api error  or  if IP is banned... send alert over telegram
                    if(apiErrorHandlerCounter === 3                                                                       ||
                       (error.hasOwnProperty("statusCode")  &&  (error.statusCode === 418  ||  error.statusCode === 429)) ){

                        await telegramController.sendMessage(telegram, "API ERROR:\n\n"+error.errorMessage+"\n\ndata:\n"+JSON.stringify(error.data, null, 4), "text")
                            .catch(async (error) => {
                                await log.save(error, "error");
                            })
                    }
                }
                else{
                    await telegramController.sendMessage(telegram, "TRADE ERROR:\n\n"+JSON.stringify(error, null, 4), "text")
                        .catch(async (telegramError) => {
                            await log.save(telegramError, "error");
                        })
                }
            }
        })
});
//--------------------------------------------------------------------------------


//---------------------------------MESSAGING--------------------------------------
// telegram
telegramController.listenMessages(telegram, SEMAPHORE_miniDB)
    .then((response) => {
        telegram = response;
    });
//--------------------------------------------------------------------------------


//---------------------------------SECONDARY-TASKS--------------------------------
// scheduler that checks internet connection and run tasks after connection is back online
CRON_internetCheck.schedule(env.hardwareAlerts_frequencyOf_internetCheck, async () => {

    await secondaryTasksController.internetCheck()
        .then(async (responseInternetStatus) => {
            internetStatus = responseInternetStatus.online;

            // tasks to run when internet connection is back online
            if(responseInternetStatus.runTasks){

                // restart telegram connection
                await telegramController.restartConnection(telegram)
                    .then(async (responseTelegram) => {

                        telegram = responseTelegram;
                        await log.save({
                            data:            null,
                            redirectedError: false,
                            errorMessage:    "telegram connection restarted and back online",
                            from:            "main -> CRON_internetCheck -> secondaryTasksController.internetCheck -> telegramController.restartConnection"
                        }, "error");

                        await telegramController.sendMessage(telegram, "Internet back online\n\n\n" +
                                                                                "Disconnected at:\n"+ utils.getDateStampFromTimeStamp(responseInternetStatus.timestampDisconnectedAt)+"\n\n" +
                                                                                "Reconnected at:\n"+  utils.getDateStampFromTimeStamp(responseInternetStatus.timestampReconnectedAt)+"\n\n" +
                                                                                "Time Offline:\n"+    Math.floor((responseInternetStatus.timestampReconnectedAt-responseInternetStatus.timestampDisconnectedAt)/60)+"  minutes\n"+
                                                                                                      ( (responseInternetStatus.timestampReconnectedAt-responseInternetStatus.timestampDisconnectedAt)-(60*Math.floor((responseInternetStatus.timestampReconnectedAt-responseInternetStatus.timestampDisconnectedAt)/60)) )+"  seconds", "text")
                            .catch(async (telegramError) => {
                                await log.save(telegramError, "error");
                            })
                    })
                    .catch(async (error) => {
                        await log.save(error, "error");
                    });
            }
        });
});

// scheduler that rotate all logs
CRON_rotateLogs.schedule('0 * * * *', async () => {

    await log.rotateLogs()
        .catch(async (error) => {
            await log.save(error, "error");
        })
});

// scheduler that checks hardware (CPU, RAM, DISK, TEMPERATURE)
CRON_rotateLogs.schedule('* * * * *', async () => {

    await secondaryTasksController.hardwareCheck()
        .then(async (hardwareCheckResult) => {

            if(hardwareCheckResult){
                await telegramController.sendMessage(telegram, "HARDWARE ALERT !!!\n\nat  "+utils.getDateStamp()+"\n\n\n" + hardwareCheckResult, "text")
                    .catch(async (error) => {
                        await log.save(error, "error");
                    })
            }
        })
        .catch(async (error) => {
            await log.save(error, "error");
        })
});
//--------------------------------------------------------------------------------


//---------------------------------ERROR-HANDLER----------------------------------
// catch (unhandledRejections ||  warnings) and log them
let errorHandler = async (error) => {
    error = {data:            "uncaughtError",
             redirectedError: false,
             errorMessage:    error.stack.replace(/\n/g, '\n\n'),
             from:            "main -> process.on(unhandledRejection  ||  warning)"};

    await log.save(error, "error");
    await telegramController.sendMessage(telegram, "UNCAUGHT ERROR:\n\n"+error.errorMessage, "text")
        .catch(async (telegramError) => {
            await log.save(telegramError, "error");
        })
}
process.on('unhandledRejection', errorHandler);
process.on('warning',            errorHandler);
//--------------------------------------------------------------------------------