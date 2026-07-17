export const sellerOrderEmail = ({
  sellerName,
  orderId,
}) => `
<div style="font-family:Arial,sans-serif">
    <h2>Congratulations, ${sellerName}! 🎉</h2>

    <p>
        You have received a new order on
        <strong>Ile-Ire Herbal Store</strong>.
    </p>

    <p>
        <strong>Order ID:</strong> ${orderId}
    </p>

    <p>
        The customer's payment has been successfully received.
    </p>

    <h3>What happens next?</h3>

    <ul>
        <li>Prepare and ship the order promptly.</li>
        <li>
            Your earnings will be automatically credited to your wallet
            after <strong>8 days</strong>.
        </li>
    </ul>

    <p>
        If the customer reports that they have not received their order
        within <strong>7 days</strong>, we will investigate before the
        payout is released.
    </p>

    <p>Thank you for selling with us.</p>

</div>
`;