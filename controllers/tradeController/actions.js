const crypto =                  require('crypto');
const superagent =              require('superagent');
const utils =                   require('./../../utils/utils');
const log =                     require('./../logController').getInstance();
const telegramController =      require("./../telegramController");
const randomstring =            require("randomstring");
const miniDBController =        require("./../miniDBcontroller");
const env =                     require('dotenv').config().parsed;

async function placeOrder(orderSide, assetFiatPrice, accountBalance, exchangeInfo, telegram, miniDB, SEMAPHORE_miniDB){
    return new Promise(async (resolve, reject) => {

        // if fiatBalance or (assetBalance*price) is HIGHER than minimumOrder for this asset... place order
        if(accountBalance.fiat*(Number(env.trade_percentageOf_fiatToUseWhenBuying) / 100) > Number(exchangeInfo.minOrder)                    ||
           (accountBalance.asset*(Number(env.trade_percentageOf_assetToUseWhenSelling)/100)*assetFiatPrice > Number(exchangeInfo.minOrder))  ){

            // setting order options
            let orderOptions =              {symbol: miniDB.selectedSymbol};
            orderOptions.type =             "LIMIT";
            orderOptions.timeInForce =      "GTC";
            orderOptions.newClientOrderId = randomstring.generate(10);
            orderOptions.newOrderRespType = "ACK";
            orderOptions.timestamp =        Date.now()+parseInt(env.binance_serverTimeCorrection);
            orderOptions.price =            assetFiatPrice.toFixed(exchangeInfo.quoteAssetPrecision);
            orderOptions.side =             orderSide;
            if(orderOptions.side === "BUY"){
                orderOptions.fiatToUse =    accountBalance.fiat*(Number(env.trade_percentageOf_fiatToUseWhenBuying) / 100);
                orderOptions.quantity =     (orderOptions.fiatToUse / orderOptions.price).toFixed(exchangeInfo.minQty);
            }
            else if(orderOptions.side === "SELL"){
                orderOptions.assetToUse =   accountBalance.asset*(Number(env.trade_percentageOf_assetToUseWhenSelling)/100);
                orderOptions.quantity =     orderOptions.assetToUse.toFixed(exchangeInfo.minQty);
            }

            let dataToSign = "symbol="+orderOptions.symbol+"&side="+orderOptions.side+"&type="+orderOptions.type+"&timeInForce="+orderOptions.timeInForce+"&quantity="+orderOptions.quantity+"&price="+orderOptions.price+"&newClientOrderId="+orderOptions.newClientOrderId+"&newOrderRespType="+orderOptions.newOrderRespType+"&timestamp="+orderOptions.timestamp;
            let hmacSignature = crypto.createHmac('sha256', env.binance_secret).update(dataToSign).digest('hex');

            await superagent.post(env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature)
                .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
                .timeout(15000)
                .then(async (response) => {

                    // save last order info on miniDB
                    miniDB.lastOrder =           orderOptions;
                    miniDB.lastOrder.status =    "PENDING";
                    miniDB.lastOrder.dateStamp = utils.getDateStampFromTimeStamp(response.body.transactTime);
                    await miniDBController.saveMiniDB(SEMAPHORE_miniDB, miniDB)
                        .then(async () => {
                            resolve(miniDB.lastOrder);
                        })
                        .catch(async (error) => {
                            reject(error);
                        })
                })
                .catch(async (error) => {
                    error = utils.apiErrorHandler(error, {action: "placeOrder", order: orderOptions, url: env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});
                    reject(error);
                })
        }

        // if fiatBalance or (assetBalance*price) is LOWER than minimumOrder for this asset... send alert "not enough money" over telegram
        else{
            let alert = "Please add money to account\n\n" + env.trade_fiat + " balance: " + accountBalance.fiat + "\n" + miniDB.selectedSymbol.replace(env.trade_fiat,'') + " balance: " + accountBalance.asset + "\n\nminimal fiat needed for trade: "+Math.round(exchangeInfo.minOrder) + " " + env.trade_fiat;
            await telegramController.sendMessage(telegram, alert, "text")
                .catch(async (error) => {
                    await log.save(error, "error");
                })
                .finally(() => {
                    reject({
                        alertSent:       true,
                        data:            "symbol: "+miniDB.selectedSymbol,
                        redirectedError: false,
                        errorMessage:    "not enough money to continue trading",
                        from:            "tradeController_actions -> placeOrder -> notEnoughMoney"});
                })
        }
    })
}

async function cancelOrder(orderOptions){
    return new Promise(async (resolve, reject) => {

        let dataToSign =    "symbol="+    orderOptions.symbol+
                            "&origClientOrderId="+  orderOptions.clientOrderId+
                            "&timestamp="+(Date.now()+parseInt(env.binance_serverTimeCorrection));
        let hmacSignature = crypto.createHmac('sha256', env.binance_secret).update(dataToSign).digest('hex');

        await superagent.delete(env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature)
            .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
            .timeout(15000)
            .then(async () => {
                resolve(true);
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action: "cancelOrder", order: orderOptions, url: env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});
                reject(error);
            })
    })
}

async function checkLastOrderStatus(lastOrder, assetFiatPrice, exchangeInfo, telegram, SEMAPHORE_miniDB, miniDB, elEssePatternSignal){
    return new Promise(async (resolve, reject) => {
        let priceOfLastBuyOrder;

        // if last order DON'T exist
        if(!lastOrder){
            resolve(false);
        }

        // if lastOrder is PENDING
        else if(lastOrder.status !== "CANCELED"  &&  lastOrder.status !== "FILLED"){

            // if lastOrder is pending for more than allowed time  &&
            //   (if lastOrder side is BUY   and  elEssePatternSignal is BUY )  or
            //   (if lastOrder side is SELL  and  elEssePatternSignal is SELL)
            if((Date.now() - lastOrder.time) > (parseInt(env.cso_timeoutInSeconds)*1000)  &&
                ( (lastOrder.side === "BUY"  && elEssePatternSignal === "BUY")     ||
                    (lastOrder.side === "SELL" && elEssePatternSignal === "SELL") )  ){

                await cancelOrder(lastOrder)
                    .then(async () => {

                        let notification = lastOrder.side + " " + lastOrder.symbol.replace(env.trade_fiat,'') + " order was found stale, so it was cancelled!\n\norder: \n" + JSON.stringify(lastOrder, null, 4);
                        await log.save(notification, "info");

                        await telegramController.sendMessage(telegram, notification, "text")
                            .catch(async (error) => {
                                await log.save(error, "error");
                            })
                            .finally(() => {
                                resolve(false);
                            })
                    })
                    .catch((error) => {
                        reject(error);
                    })
            }
            else{
                resolve(true);
            }
        }

        // if lastOrder is just FILLED
        else if(lastOrder.status === "FILLED"  &&  miniDB.lastOrder.status === "PENDING"){

            // if order side is SELL... Add +1 to sellOrdersFilled on miniDB
            // if order side is BUY...  Add +1 to buyOrdersFilled on miniDB... then send notification over telegram
            await (new Promise(async (innerResolve) => {

                // save filled order info on miniDB
                miniDB.lastOrder.status = "FILLED";
                switch (lastOrder.side){
                    case "BUY":
                        miniDB.buyOrdersFilled =         1+ miniDB.buyOrdersFilled;
                        miniDB.priceOfLastBuyOrder =     lastOrder.price;
                        miniDB.timestampOfLastBuyOrder = utils.getTimeStamp();
                        break;
                    case "SELL":
                        miniDB.sellOrdersFilled = 1+ miniDB.sellOrdersFilled;
                        miniDB.profits = ( ( (1+(miniDB.profits/100)) * (1+( ((((lastOrder.price*100)/Number(miniDB.priceOfLastBuyOrder))-100)-Number(env.trade_exchangeFeePercentage))/100 )) * 100) - 100);

                        // search for new symbol to invest after each sell... if it's active
                        if(env.trade_searchFor_newSymbolToInvest_afterEachSell === "true"  &&  !env.trade_staticAsset){
                          miniDB.activeSymbol =            null;
                          priceOfLastBuyOrder  =           miniDB.priceOfLastBuyOrder
                          miniDB.priceOfLastBuyOrder =     null;
                        }
                        break;
                }

                await miniDBController.saveMiniDB(SEMAPHORE_miniDB, miniDB)
                    .catch(async (error) => {
                        await log.save(error, "error");
                    })
                    .finally(async () => {
                        innerResolve(true);
                    })
            }))
            .finally(async () => {

                let notification = lastOrder.symbol.replace(env.trade_fiat,'') + " " + lastOrder.side + " order FILLED";
                if(lastOrder.side === "SELL"){ notification = notification + "\n\nBuy price:  "+(miniDB.priceOfLastBuyOrder ? miniDB.priceOfLastBuyOrder : priceOfLastBuyOrder)+"\nSell price:  "+lastOrder.price+"\nProfit:  "+((((lastOrder.price*100)/Number((miniDB.priceOfLastBuyOrder ? miniDB.priceOfLastBuyOrder : priceOfLastBuyOrder)))-100)-Number(env.trade_exchangeFeePercentage)).toFixed(2)+" %" }
                lastOrder.dateStamp = utils.getDateStampFromTimeStamp(lastOrder.time);
                notification = notification + "\n\norder: \n" + JSON.stringify(lastOrder, null, 4);

                if(lastOrder.side === "SELL"){
                    let timestampSell = utils.getTimeStamp();
                    let timestampBuy =  parseInt(miniDB.timestampOfLastBuyOrder);

                    let waitingTime =   ( Math.floor((timestampSell-timestampBuy)/(60*60*24)) > 0 ? Math.floor((timestampSell-timestampBuy)/(60*60*24))+"  days, " :"")+
                                        ( Math.floor((timestampSell-timestampBuy)/(60*60)) > 0    ? Math.floor((timestampSell-timestampBuy)/(60*60))   +"  hours, " :"")+
                                        ( Math.floor((timestampSell-timestampBuy)/60) > 0         ? Math.floor((timestampSell-timestampBuy)/60)        +"  minutes, " :"")+
                                        ( (timestampSell-timestampBuy)-(60*Math.floor((timestampSell-timestampBuy)/60)) )                                 +"  seconds.";
                    await log.save({profit:      miniDB.profits.toLocaleString()+" %",
                                    waitingTime: waitingTime,
                                    symbol:      lastOrder.symbol}, "profits");
                }
                await log.save(notification, "info");

                await telegramController.sendMessage(telegram, notification, "text")
                    .catch(async (error) => {
                        await log.save(error, "error");
                    })
                    .finally(() => {

                        if(miniDB.activeSymbol){
                            resolve(false);
                        }
                        else{
                            resolve(true);
                        }
                    })
            })
        }

        // if lastOrder is already FILLED
        else if(lastOrder.status === "FILLED"  &&  miniDB.lastOrder.status === "FILLED"){
            resolve(false);
        }

        // if lastOrder is CANCELED
        else if(lastOrder.status === "CANCELED"){
            resolve(false);
        }
    })
}

module.exports = {
    checkLastOrderStatus,
    placeOrder
};