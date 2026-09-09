import { describe, expect, it } from 'bun:test';
import { MetaPayloadParser } from '../../src/meta/meta-payload.parser';

describe('MetaPayloadParser', () => {
  const parser = new MetaPayloadParser();

  it('parsea un mensaje de texto', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PN1' },
                messages: [{ id: 'wamid.1', from: '58911', type: 'text', text: { body: 'hola' } }],
              },
            },
          ],
        },
      ],
    };

    expect(parser.parse(payload)).toEqual([
      { phoneNumberId: 'PN1', messages: [{ messageId: 'wamid.1', from: '58911', type: 'text', text: 'hola' }] },
    ]);
  });

  it('parsea imagen y ubicación en el mismo evento', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PN1' },
                messages: [
                  { id: 'm1', from: '58911', type: 'image', image: { id: 'media123' } },
                  { id: 'm2', from: '58911', type: 'location', location: { latitude: 10.5, longitude: -66.9 } },
                ],
              },
            },
          ],
        },
      ],
    };

    const [event] = parser.parse(payload);
    expect(event!.messages[0]).toEqual({ messageId: 'm1', from: '58911', type: 'image', mediaId: 'media123' });
    expect(event!.messages[1]).toEqual({
      messageId: 'm2',
      from: '58911',
      type: 'location',
      latitude: 10.5,
      longitude: -66.9,
    });
  });

  it('ignora payloads que solo traen statuses (delivered/read)', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PN1' },
                statuses: [{ id: 'wamid.1', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };

    expect(parser.parse(payload)).toEqual([]);
  });

  it('devuelve vacío para payloads malformados o vacíos', () => {
    expect(parser.parse({})).toEqual([]);
    expect(parser.parse(null)).toEqual([]);
    expect(parser.parse({ entry: 'no-es-un-array' })).toEqual([]);
  });
});
