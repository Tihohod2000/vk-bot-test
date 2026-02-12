import { Injectable, OnModuleInit } from '@nestjs/common';
import { VK, Keyboard } from 'vk-io';

@Injectable()
export class VkService implements OnModuleInit {
  private vk: VK;

  constructor() {
    const token = process.env.VK_BOT_TOKEN;
    if (!token) throw new Error('VK_BOT_TOKEN не задан!');
    this.vk = new VK({ token });
  }

  async onModuleInit() {
    const { updates } = this.vk;

    (this.vk.updates as any).on('raw', (update) => {
      console.log('RAW:', update.type, update.object);
    });

    // Подписка на новые сообщения
    updates.on('message_new', async (context) => {
      if (context.isOutbox) return;

      // Отправляем сообщение с inline callback-кнопками
      await context.send({
        message: 'Привет! Выберите кнопку:',
        keyboard: this.getKeyboard(),
      });
    });

    // Подписка на нажатие callback-кнопки
    updates.on('message_event', async (ctx) => {
      const payload = ctx.eventPayload as { button: string };

      // Сначала отвечаем VK, чтобы кнопка перестала крутиться
      await ctx.answer({
        type: 'show_snackbar',
        text: `Вы нажали: ${payload.button}`,
      });

      // Потом можно редактировать сообщение
      await this.vk.api.messages.edit({
        conversation_message_id: ctx.conversationMessageId,
        peer_id: ctx.peerId,
        message: `Вы выбрали: ${payload.button}`,
        keyboard: Keyboard.builder().inline().callbackButton({
          label: 'Stop',
          // payload: { button: 'click_me' }, // callback payload
          color: 'negative',
        }),
      });
    });

    await updates.start();
    console.log('VK Bot с callback-кнопками запущен!');
  }

  private getKeyboard() {
    return Keyboard.builder()
      .inline() // обязательно inline для callback
      .callbackButton({
        label: 'Нажми меня',
        payload: { button: 'click_me' }, // callback payload
        color: 'primary',
      })
      .row()
      .callbackButton({
        label: 'Другая кнопка',
        payload: { button: 'another' },
        color: 'secondary',
      });
  }
}
