const crypto =               require("crypto");
const superagent =           require("superagent");
const utils =                require("./../../utils/utils");
const randomstring =         require("randomstring");
const tradeController_info = require("./../tradeController/info");
const miniDBController =     require("../miniDBcontroller");
const env =                  require('dotenv').config().parsed;
const log =                  require('./../logController').getInstance();

async function cancelAllOpenOrdersAndSellAsset(telegram, SEMAPHORE_miniDB){
    return new Promise(async (resolve, reject) => {

        await miniDBController.readMiniDB(SEMAPHORE_miniDB)
            .then(async (miniDB) => {

                // cancel all open orders
                await cancelAllOpenOrders(miniDB)
                    .then(async () => {

                        // if lastOrder is BUY and its filled... sell asset at market price
                        if(miniDB.lastOrder  &&  miniDB.lastOrder.side === "BUY"  &&  miniDB.lastOrder.status === "FILLED"){

                            await sellAssetAtMarketPrice(miniDB)
                                .then(async () => {

                                    // set all miniDB values to default
                                    miniDB.tradeEnabled =               false;
                                    miniDB.selectedSymbol =             null;
                                    miniDB.activeSymbol =               null;
                                    miniDB.lastOrder =                  null;
                                    miniDB.profits =                    0
                                    miniDB.sellOrdersFilled =           0;
                                    miniDB.buyOrdersFilled =            0;
                                    miniDB.timestampStartRoundOfTrade = null;
                                    miniDB.priceOfLastBuyOrder =        null;
                                    miniDB.timestampOfLastBuyOrder =    null;

                                    await miniDBController.saveMiniDB(SEMAPHORE_miniDB, miniDB)
                                        .then(async () => {
                                            resolve(true)
                                        })
                                        .catch(async (error) => {
                                            reject(error);
                                        })
                                })
                        }
                        else{
                            resolve(true)
                        }
                    })
            })
            .catch(async (error) => {
                reject(error);
            })
    })
}

async function cancelAllOpenOrders(miniDB){
    return new Promise(async (resolve) => {

        if(miniDB.lastOrder){
            await tradeController_info.getOpenOrders(miniDB.lastOrder.symbol)
                .then(async (openOrders) => {

                    if(openOrders.length > 0){
                        for(let i = 0; i < openOrders.length; i++){

                            let dataToSign = "symbol="+     miniDB.lastOrder.symbol+
                                "&origClientOrderId="+   openOrders[i].clientOrderId+
                                "&recvWindow=60000"+
                                "&timestamp="+ (Date.now()+parseInt(env.binance_serverTimeCorrection));
                            let hmacSignature = crypto.createHmac('sha256', env.binance_secret).update(dataToSign).digest('hex');

                            await superagent.delete(env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature)
                                .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
                                .timeout(15000)
                                .catch(async (error) => {
                                    error = utils.apiErrorHandler(error, {action: "cancelAllOpenOrders", order: openOrders[i], url: env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});

                                    await log.save( error,"error");
                                    if(i+1 === openOrders.length){
                                        resolve(true);
                                    }
                                })
                                .finally(() => {
                                    if(i+1 === openOrders.length){
                                        resolve(true);
                                    }
                                })
                        }
                    }
                    else{
                        resolve(true);
                    }
                })
                .catch(async (error) => {
                    await log.save( error,"error");
                    resolve(true);
                })
        }
        else{
            resolve(true);
        }
    })
}

async function sellAssetAtMarketPrice(miniDB){
    return new Promise(async (resolve) => {

        if(miniDB.lastOrder){
            // get exchangeInfo of asset
            await tradeController_info.getExchangeInfo(miniDB.lastOrder.symbol)
                .then(async (exchangeInfo) => {

                    // get account balance of asset, fiat
                    await tradeController_info.getAccountBalances(miniDB.lastOrder.symbol)
                        .then(async (accountBalance) => {

                            // place MARKET SELL order
                            let orderOptions =              {symbol: miniDB.lastOrder.symbol}
                            orderOptions.type =             "MARKET";
                            orderOptions.newClientOrderId = randomstring.generate(10);
                            orderOptions.newOrderRespType = "ACK";
                            orderOptions.timestamp =        Date.now()+parseInt(env.binance_serverTimeCorrection);
                            orderOptions.side =             "SELL";
                            orderOptions.assetToUse =       accountBalance.asset*(Number(env.trade_percentageOf_assetToUseWhenSelling) / 100);
                            orderOptions.quantity =         orderOptions.assetToUse.toFixed(exchangeInfo.minQty);

                            if(orderOptions.quantity > 0){

                                let dataToSign = "symbol="+orderOptions.symbol+"&side="+orderOptions.side+"&type="+orderOptions.type+"&quantity="+orderOptions.quantity+"&newClientOrderId="+orderOptions.newClientOrderId+"&newOrderRespType="+orderOptions.newOrderRespType+"&timestamp="+orderOptions.timestamp;
                                let hmacSignature = crypto.createHmac('sha256', env.binance_secret).update(dataToSign).digest('hex');

                                await superagent.post(env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature)
                                    .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
                                    .timeout(15000)
                                    .then(async () => {
                                        resolve(true);
                                    })
                                    .catch(async (error) => {
                                        error = utils.apiErrorHandler(error, {action: "cancelAllOpenOrdersAndSellAsset -> SellAsset", order: orderOptions, url: env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});
                                        await log.save(error,"error");
                                        resolve(true);
                                    })
                            }
                            else{
                                resolve(true)
                            }
                        })
                        .catch(async (error) => {
                            await log.save(error,"error");
                            resolve(true);
                        })
                })
                .catch(async (error) => {
                    await log.save(error,"error");
                    resolve(true);
                })
        }
        else{
            resolve(true);
        }
    })
}

module.exports = {
    cancelAllOpenOrdersAndSellAsset
};