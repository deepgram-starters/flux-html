export function createTurnContainer(elements, turnIndex) {
  if (elements.emptyState && !elements.emptyState.classList.contains('hidden')) {
    elements.emptyState.classList.add('hidden');
  }

  const existing = document.getElementById(`turn-${turnIndex}`);
  if (existing) return existing;

  const container = document.createElement('div');
  container.className = 'transcript-turn';
  container.id = `turn-${turnIndex}`;

  const item = document.createElement('div');
  item.className = 'transcript-item transcript-item--start-of-turn';
  item.id = `turn-item-${turnIndex}`;

  const header = document.createElement('div');
  header.className = 'transcript-item__header';

  const timestamp = document.createElement('div');
  timestamp.className = 'dg-prose dg-prose--small dg-text-muted';
  timestamp.textContent = new Date().toLocaleTimeString();

  const badge = document.createElement('span');
  badge.className = 'turn-event-badge turn-event-badge--start-of-turn';
  badge.id = `turn-badge-${turnIndex}`;
  badge.textContent = 'Start';

  header.appendChild(timestamp);
  header.appendChild(badge);
  item.appendChild(header);

  const text = document.createElement('div');
  text.className = 'dg-prose';
  text.id = `turn-text-${turnIndex}`;
  item.appendChild(text);

  container.appendChild(item);
  elements.transcriptContainer.appendChild(container);
  elements.transcriptContainer.scrollTop = elements.transcriptContainer.scrollHeight;
  return container;
}
