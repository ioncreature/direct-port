import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../database/entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {}

  async findAll() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    return users.map((u) => this.sanitize(u));
  }

  async findOne(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async create(dto: CreateUserDto) {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
    });
    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email !== undefined) user.email = dto.email;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async remove(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.usersRepo.remove(user);
  }

  private sanitize(user: User) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
