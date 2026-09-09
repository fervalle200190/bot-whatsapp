import { Module } from '@nestjs/common';
import { N8nAgentService } from './n8n-agent.service';

@Module({
  providers: [N8nAgentService],
  exports: [N8nAgentService],
})
export class N8nModule {}
