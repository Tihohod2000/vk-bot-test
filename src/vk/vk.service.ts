import { Injectable, OnModuleInit } from '@nestjs/common';
import { VK, Keyboard } from 'vk-io';

@Injectable()
export class VkService implements OnModuleInit {
  private vk: VK;
  private gameState: Map<
    number,
    {
      nextNumber: number;
      lastNumber: number;
      revealed: number[];
      startTime: number;
      shuffledIndices: number[];
      wrongRevealed?: number[];
      attempts: number;
    }
  > = new Map();
  private processingUsers: Set<number> = new Set();
  private userStats: Map<
    number,
    {
      gamesPlayed: number;
      bestTime: number | null;
      bestAttempts: number | null;
      totalAttempts: number;
    }
  > = new Map();

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
    updates.on('message_new', async (ctx) => {
      if (ctx.isOutbox) return;

      const text = (ctx.text || '').trim().toLowerCase();

      // Обработка команды /статистика или !статистика
      if (text === '/статистика' || text === '!статистика' || text === 'статистика') {
        await this.showStats(ctx.peerId, ctx);
        return;
      }

      // Создаем случайный порядок индексов для 9 чисел
      const shuffledIndices = Array.from({ length: 9 }, (_, i) => i).sort(
        () => Math.random() - 0.5,
      );

      // Инициализируем состояние игры для пользователя
      this.gameState.set(ctx.peerId, {
        nextNumber: 1,
        lastNumber: 0,
        revealed: [],
        startTime: Date.now(),
        shuffledIndices,
        attempts: 0,
      });

      // Отправляем сообщение с inline callback-кнопками
      await ctx.send({
        message: 'Привет! Найдите все цифры по порядку от 1 до 9:',
        keyboard: this.getKeyboard(ctx.peerId),
      });
    });

    // Подписка на нажатие callback-кнопки
    updates.on('message_event', async (ctx) => {
      const payload = ctx.eventPayload as { action: string; index?: string };
      const peerId = ctx.peerId;

      // Проверяем, не обрабатываем ли уже клик этого пользователя
      if (this.processingUsers.has(peerId)) return;
      this.processingUsers.add(peerId);

      const gameData = this.gameState.get(peerId);
      if (!gameData) {
        this.processingUsers.delete(peerId);
        return;
      }

      // Обработка числовых кнопок
      const clickedNumber = parseInt(payload.index!) + 1;

      try {
        if (clickedNumber === gameData.nextNumber) {
          // Правильный ответ
          gameData.revealed.push(gameData.nextNumber);
          gameData.nextNumber++;
          gameData.lastNumber = clickedNumber;

          this.gameState.set(peerId, gameData);

          // Редактируем сообщение с новой клавиатурой
          const messageText = this.getMessageText(gameData);
          await this.vk.api.messages.edit({
            conversation_message_id: ctx.conversationMessageId,
            peer_id: peerId,
            message: messageText,
            keyboard: this.getKeyboard(peerId),
          });

          // Проверяем, завершена ли игра
          if (gameData.nextNumber > 9) {
            this.saveStats(peerId, gameData);
          }
        }
        else if (clickedNumber == gameData.lastNumber) {

          await this.vk.api.messages.sendMessageEventAnswer({
            event_id: ctx.eventId,
            user_id: ctx.userId,
            peer_id: ctx.peerId,
          });
        }
        else {
          // Ошибка - показываем открытую кнопку красным и число на 2 сек
          gameData.attempts++;
          gameData.wrongRevealed = [clickedNumber];
          this.gameState.set(peerId, gameData);

          // Редактируем сообщение, чтобы показать открытую кнопку красным с числом
          await this.vk.api.messages.edit({
            conversation_message_id: ctx.conversationMessageId,
            peer_id: peerId,
            message: `Найдите все цифры по порядку. Ищите: ${gameData.nextNumber}`,
            keyboard: this.getKeyboard(peerId),
          });

          // Ждем 2 секунды
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Сбрасываем все: wrongRevealed, revealed и nextNumber
          gameData.wrongRevealed = [];
          gameData.lastNumber = 0
          gameData.nextNumber = 1;
          gameData.revealed = [];

          this.gameState.set(peerId, gameData);

          // Редактируем сообщение после задержки (все кнопки закрыты)
          const messageText = this.getMessageText(gameData);
          await this.vk.api.messages.edit({
            conversation_message_id: ctx.conversationMessageId,
            peer_id: peerId,
            message: messageText,
            keyboard: this.getKeyboard(peerId),
          });
        }
      } finally {
        // Удаляем пользователя из очереди обработки
        this.processingUsers.delete(peerId);
      }
    });

    await updates.start();
    console.log('VK Bot с callback-кнопками запущен!');
  }

  private getMessageText(gameData: {
    nextNumber: number;
    lastNumber: number;
    revealed: number[];
    startTime: number;
    attempts: number;
  }): string {
    if (gameData.nextNumber > 9) {
      const elapsedSeconds = Math.floor(
        (Date.now() - gameData.startTime) / 1000,
      );
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      return `🎉 Поздравляем! Вы нашли все цифры!\n⏱️ Время: ${minutes}м ${seconds}с\n❌ Попыток: ${gameData.attempts}`;
    }
    return `Найдите все цифры по порядку. Ищите: ${gameData.nextNumber}`;
  }

  private getKeyboard(peerId: number) {
    const keyboard = Keyboard.builder().inline();
    const gameData = this.gameState.get(peerId);

    if (!gameData) {
      return keyboard;
    }

    return this.getKeyboardWithData(peerId, gameData);
  }

  private getKeyboardWithData(
    _peerId: number,
    gameData: {
      nextNumber: number;
      revealed: number[];
      startTime: number;
      shuffledIndices: number[];
      wrongRevealed?: number[];
    },
  ) {
    const keyboard = Keyboard.builder().inline();

    // Используем сохраненный порядок кнопок
    const indices = gameData.shuffledIndices;

    // Создаем сетку 3x3 с кнопками (всего 9 кнопок)
    for (let i = 0; i < 9; i++) {
      const index = indices[i];
      const number = index + 1;
      const isRevealed = gameData.revealed.includes(number);
      const isWrong = gameData.wrongRevealed?.includes(number);

      keyboard.callbackButton({
        label: isWrong ? String(number) : isRevealed ? String(number) : '?',
        payload: { index: String(index) },
        color: isWrong ? 'negative' : isRevealed ? 'positive' : 'secondary',
      });

      // Переход на новую строку после каждых 3 кнопок (3 ряда)
      if ((i + 1) % 3 === 0 && i < 8) {
        keyboard.row();
      }
    }

    return keyboard;
  }

  private saveStats(
    peerId: number,
    gameData: {
      startTime: number;
      attempts: number;
    },
  ) {
    const elapsedSeconds = Math.floor((Date.now() - gameData.startTime) / 1000);
    const stats = this.userStats.get(peerId) || {
      gamesPlayed: 0,
      bestTime: null,
      bestAttempts: null,
      totalAttempts: 0,
    };

    stats.gamesPlayed++;
    stats.totalAttempts += gameData.attempts;

    if (stats.bestTime === null || elapsedSeconds < stats.bestTime) {
      stats.bestTime = elapsedSeconds;
    }

    if (stats.bestAttempts === null || gameData.attempts < stats.bestAttempts) {
      stats.bestAttempts = gameData.attempts;
    }

    this.userStats.set(peerId, stats);
  }

  private async showStats(peerId: number, ctx: any) {
    const stats = this.userStats.get(peerId);
    const gameData = this.gameState.get(peerId);

    if (!stats || stats.gamesPlayed === 0) {
      await ctx.send('📊 У вас пока нет завершённых игр.\nПройдите игру хотя бы один раз!');
      return;
    }

    const avgAttempts = (stats.totalAttempts / stats.gamesPlayed).toFixed(2);

    let message = `📊 **Ваша статистика**:\n`;
    message += `🎮 Игр пройдено: ${stats.gamesPlayed}\n`;

    if (stats.bestTime !== null) {
      const minutes = Math.floor(stats.bestTime / 60);
      const seconds = stats.bestTime % 60;
      message += `⏱️ Лучшее время: ${minutes}м ${seconds}с\n`;
    }

    if (stats.bestAttempts !== null) {
      message += `🎯 Лучшее количество попыток: ${stats.bestAttempts}\n`;
    }

    message += `📈 Среднее количество попыток: ${avgAttempts}`;

    // Добавляем статистику текущей игры, если она активна
    if (gameData && gameData.nextNumber <= 9) {
      const elapsedSeconds = Math.floor((Date.now() - gameData.startTime) / 1000);
      const currentMinutes = Math.floor(elapsedSeconds / 60);
      const currentSeconds = elapsedSeconds % 60;
      message += `\n\n🎮 **Текущая игра**:\n`;
      message += `⏱️ Время: ${currentMinutes}м ${currentSeconds}с\n`;
      message += `❌ Попыток: ${gameData.attempts}`;
    }

    await ctx.send(message);
  }
}
