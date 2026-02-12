import { Module } from '@nestjs/common';
import { VkService } from './vk.service';

@Module({
  providers: [VkService],
})
export class VkModule {}
