export const buyerOrderEmail = ({
    customerName,
    orderId
}) => `
<h2>Thank you for your purchase, ${customerName}!</h2>

<p>Your order has been confirmed.</p>

<p><strong>Order ID:</strong> ${orderId}</p>

<p>
The seller has been notified and is preparing your order.
</p>

<p>
If you do not receive your order within
<strong>7 days</strong>, please contact us through the Contact page so we can investigate before payment is released.
</p>

<p>Thank you for shopping with Ile-Ire Herbal Store.</p>
`;