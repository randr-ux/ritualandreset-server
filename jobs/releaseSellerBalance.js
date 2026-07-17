import pool from "../config/db.js";


export const releaseSellerBalances = async()=>{

const client = await pool.connect();


try{

await client.query("BEGIN");


const earnings = await client.query(
`
SELECT *
FROM seller_pending_earnings
WHERE status='pending'
AND available_at <= NOW()
FOR UPDATE
`
);


for(const earning of earnings.rows){


await client.query(
`
UPDATE seller_wallets

SET

pending_balance =
pending_balance - $1,

available_balance =
available_balance + $1,

updated_at = NOW()

WHERE seller_id=$2

`,
[
earning.amount,
earning.seller_id
]
);



await client.query(
`
UPDATE seller_pending_earnings

SET

status='released',
released_at=NOW()

WHERE id=$1

`,
[
earning.id
]
);


}



await client.query("COMMIT");


}catch(error){

await client.query("ROLLBACK");

console.error(error);


}finally{

client.release();

}


};