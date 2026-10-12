<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ number }}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px;">
                {% if language == 'en' %}
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;">{% if type == 'credit_note' %}Your credit note{% else %}Your invoice{% endif %} {{ number }}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Hello {{ customer_name }},</p>
                {% if type == 'credit_note' %}
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;">we have issued a refund for your order {{ order_number }}. The credit note{% if invoice_number %} for invoice {{ invoice_number }}{% endif %} is ready for download.</p>
                {% else %}
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;">thank you for your order {{ order_number }}. Your invoice is ready for download.</p>
                {% endif %}
                <p style="margin:0 0 24px;">
                  <a href="{{ pdf.url }}" style="display:inline-block;padding:10px 20px;background-color:#1f2933;color:#ffffff;font-size:15px;line-height:20px;text-decoration:none;border-radius:6px;">Download {{ number }} (PDF)</a>
                </p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#616e7c;">Questions about this document? Reply to this e-mail{% if store.support_email %} or write to {{ store.support_email }}{% endif %}.<br>{{ store.name }}</p>
                {% else %}
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;">{% if type == 'credit_note' %}Ihre Rechnungskorrektur{% else %}Ihre Rechnung{% endif %} {{ number }}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Guten Tag {{ customer_name }},</p>
                {% if type == 'credit_note' %}
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;">wir haben Ihnen eine Erstattung zu Ihrer Bestellung {{ order_number }} veranlasst. Die Rechnungskorrektur{% if invoice_number %} zur Rechnung {{ invoice_number }}{% endif %} steht für Sie zum Download bereit.</p>
                {% else %}
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;">vielen Dank für Ihre Bestellung {{ order_number }}. Ihre Rechnung steht für Sie zum Download bereit.</p>
                {% endif %}
                <p style="margin:0 0 24px;">
                  <a href="{{ pdf.url }}" style="display:inline-block;padding:10px 20px;background-color:#1f2933;color:#ffffff;font-size:15px;line-height:20px;text-decoration:none;border-radius:6px;">{{ number }} herunterladen (PDF)</a>
                </p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#616e7c;">Fragen zu diesem Beleg? Antworten Sie einfach auf diese E-Mail{% if store.support_email %} oder schreiben Sie an {{ store.support_email }}{% endif %}.<br>{{ store.name }}</p>
                {% endif %}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
