const form = document.getElementById('donation-form');
const message = document.getElementById('message');
const submit = form.querySelector('button[type="submit"]');

const FRIENDLY_ERRORS = {
  INVALID_AMOUNT: 'Please enter an amount greater than $0.',
  UNSUPPORTED_CURRENCY: 'That currency is not supported yet.',
};

function show(state, text) {
  message.hidden = false;
  message.dataset.state = state;
  message.textContent = text;
}

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const amount = Math.round(Number(form.elements.amount.value) * 100);
  const church = form.elements.church;
  const churchName = church.options[church.selectedIndex].textContent.trim();
  const recurring = form.elements.recurring.checked ? 'monthly' : null;

  submit.disabled = true;
  show('pending', 'Processing your gift…');

  try {
    const response = await fetch('/api/donations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'USD', churchId: church.value, donorId: 'donor_web', recurring }),
    });
    const data = await response.json();

    if (response.ok) {
      const cadence = data.donation.recurring ? ' every month' : '';
      show('success', `Thank you! Your ${dollars(data.donation.amount)} gift to ${churchName}${cadence} was received.`);
      form.reset();
    } else {
      const code = data.error && data.error.code;
      show('error', FRIENDLY_ERRORS[code] || (data.error && data.error.message) || 'Something went wrong. Please try again.');
    }
  } catch {
    show('error', 'We could not reach the server. Please try again.');
  } finally {
    submit.disabled = false;
  }
});
