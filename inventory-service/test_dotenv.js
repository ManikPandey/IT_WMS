const fs = require('fs'); fs.writeFileSync('.env.test', 'ENABLE_SEED=\
true\\\nENABLE_SEED_2=true'); require('dotenv').config({ path: '.env.test' }); console.log(process.env.ENABLE_SEED, process.env.ENABLE_SEED === 'true'); console.log(process.env.ENABLE_SEED_2, process.env.ENABLE_SEED_2 === 'true');
