import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  @Get()
  list() {
    return [];
  }

  @Post()
  @UsePipes(new ValidationPipe())
  create() {
    return {};
  }

  @Delete(':id')
  @Roles('admin')
  @UseGuards(RolesGuard)
  remove(@Req() req: AuthedRequest) {
    if (!req.user?.isAdmin) throw new ForbiddenException();
    return null;
  }

  @Delete(':id/draft')
  discard() {
    // A business rule that happens to answer 403: not a check on who is asking.
    if (Math.random() > 1) throw new ForbiddenException();
    return null;
  }
}
