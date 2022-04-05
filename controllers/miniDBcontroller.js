const fs =     require("fs");
const {exec} = require("child_process");

async function readMiniDB(SEMAPHORE_miniDB){
    return new Promise(async (resolve, reject) => {
        SEMAPHORE_miniDB.take(async () => {
            let miniDB;
            try{
                // if miniDB.json exist
                if (fs.existsSync('miniDB.json')){

                    // read and parse miniDB.json
                    miniDB = await JSON.parse((await fs.readFileSync("miniDB.json")).toString());
                }

                // if miniDB.json DON'T exist... create it with default "tradeEnabled:false, selectedSymbol:null, activeSymbol:null, lastOrder:null, ipBanUntil:null, timestampStartRoundOfTrade:null, profits:0, sellOrdersFilled:0, buyOrdersFilled:0, priceOfLastBuyOrder:null, timestampOfLastBuyOrder:null"
                else {
                    miniDB = {tradeEnabled:false, selectedSymbol:null, activeSymbol:null, lastOrder:null, ipBanUntil:null, timestampStartRoundOfTrade:null, profits:0, sellOrdersFilled:0, buyOrdersFilled:0, priceOfLastBuyOrder:null, timestampOfLastBuyOrder:null};
                    await fs.writeFileSync("miniDB.json", JSON.stringify(miniDB, null, 4));
                    await exec("cd ../ && sudo chmod 777 -R S_Trading")

                }

                SEMAPHORE_miniDB.leave();
                resolve(miniDB);
            }
            catch(error){
                SEMAPHORE_miniDB.leave();
                reject({
                    data:            "miniDB.json",
                    redirectedError: false,
                    errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                    from:            "miniDBcontroller -> readMiniDB"
                });
            }

        })
    })
}

async function saveMiniDB(SEMAPHORE_miniDB, miniDB){
    return new Promise(async (resolve, reject) => {
        SEMAPHORE_miniDB.take(async () => {
            try{
                await fs.writeFileSync("miniDB.json", JSON.stringify(miniDB, null, 4));

                SEMAPHORE_miniDB.leave();
                resolve(true);
            }
            catch(error){
                SEMAPHORE_miniDB.leave();
                reject({
                    data:            miniDB,
                    redirectedError: false,
                    errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                    from:            "miniDBcontroller -> saveMiniDB"
                });
            }
        })
    })
}

async function updateMiniDB(SEMAPHORE_miniDB, param, data){
    return new Promise(async (resolve, reject) => {

        await readMiniDB(SEMAPHORE_miniDB)
            .then(async (miniDB) => {

                miniDB[param] = data;

                await saveMiniDB(SEMAPHORE_miniDB, miniDB)
                    .then(async () => {
                        resolve(true);
                    })
                    .catch(async (error) => {
                        reject(error);
                    })
            })
            .catch(async (error) => {
                reject(error);
            })
    })
}

module.exports = {
    readMiniDB,
    saveMiniDB,
    updateMiniDB
}