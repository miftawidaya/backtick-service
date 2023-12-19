import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { User, Prisma } from '@prisma/client'
import { UserRepository } from './user.repository'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { StorageService } from '../storage/storage.service'
import { config } from '../common/config'
import { AdminUpdateUserDto } from './dto/admin-update-user.dto'

@Injectable()
export class UserService {
  constructor(
    private userRepository: UserRepository,
    private storageService: StorageService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    return await this.userRepository.create(createUserDto)
  }

  async getUserDetails(id: string) {
    return await this.userRepository.findUnique({
      where: { id },
      include: { balance: true },
    })
  }

  async findUniqueBy(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return await this.userRepository.findUnique({ where })
  }

  async checkEmailUsername(params: { username: string; email: string }) {
    const { username, email } = params
    const userAvailable = await this.userRepository.find({
      where: {
        OR: [{ email: email }, { username: username }],
      },
      select: { email: true, username: true },
    })

    if (email && userAvailable?.email === email) {
      throw new ConflictException(`Email ${email} already registered`)
    } else if (username && userAvailable?.username === username) {
      throw new ConflictException(`Username ${username} already registered`)
    }
  }

  async activate(id: string) {
    return await this.userRepository.update({
      where: { id },
      data: { activated: true },
    })
  }

  async editUser(
    id: string,
    updateUserDto: UpdateUserDto,
    image?: Express.Multer.File,
  ) {
    await this.checkEmailUsername({
      email: updateUserDto.email,
      username: updateUserDto.username,
    })

    const filename = image
      ? await this.storageService.generateRandomFilename(image.originalname)
      : undefined

    try {
      const user = await this.userRepository.update({
        where: { id },
        data: {
          ...updateUserDto,
          image: filename,
          balance:
            updateUserDto instanceof AdminUpdateUserDto
              ? {
                  update: {
                    where: { userId: id },
                    data: { balance: updateUserDto.balance },
                  },
                }
              : undefined,
        },
        include: { balance: true },
      })
      if (filename) {
        await this.storageService.createFile(
          config.storage.userImagePath,
          filename,
          image.buffer,
        )
      }
      return user
    } catch (e) {
      console.error(e)

      if (filename)
        this.storageService.deleteFile(config.storage.userImagePath, filename)
      throw new InternalServerErrorException(e)
    }
  }
}
