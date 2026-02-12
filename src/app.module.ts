import { Module } from '@nestjs/common';
import { VkModule } from './vk/vk.module';

@Module({
  imports: [VkModule],
})
export class AppModule {}
