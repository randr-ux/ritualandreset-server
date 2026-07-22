export const contactUsEmail = ({
  name,
  email,
  subject,
  message,
}) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <div style="background-color: #2E7D32; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h2 style="color: white; margin: 0;">New Contact Message</h2>
  </div>

  <div style="padding: 24px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px;>
      You have received a new message from the <strong>Contact Us</strong> form on
      <strong>Ile-Ire Herbal Store</strong>.
    </p>

    <div style="background-color: #f9f9f9; padding: 16px; border-radius: 6px; margin: 20px 0;">
      <p style="margin: 0 0 10px;"><strong>Name:</strong> ${name}</p>
      <p style="margin: 0 0 10px;"><strong>Email:</strong> ${email}</p>
      <p style="margin: 0;"><strong>Subject:</strong> ${subject}</p>
    </div>

    <h3 style="color: #2E7D32;">Message</h3>

    <div style="background-color: #f9f9f9; padding: 16px; border-radius: 6px; border-left: 4px solid #2E7D32;">
      <p style="white-space: pre-line; margin: 0;">${message}</p>
    </div>

    <p style="margin-top: 24px; font-size: 14px; color: #666;">
      You can reply directly to this email to respond to the customer, as their email address has been set as the <strong>Reply-To</strong> address.
    </p>

    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />

    <p style="font-size: 12px; color: #999; text-align: center;">
      This message was sent from the Contact Us form on Ile-Ire Herbal Store.
    </p>
  </div>
</div>
`;