import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { Prisma, User } from '@prisma/client'
import { AuthService } from '../auth/auth.service'
import { config } from '../common/config'
import { exceptions } from '../common/exceptions/exceptions'
import { StorageService } from '../storage/storage.service'
import { AdminUpdateUserDto } from './dto/admin-update-user.dto'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UserEntity } from './entities/user.entity'
import { UserRepository } from './user.repository'

@Injectable()
export class UserService {
  constructor(
    private authService: AuthService,
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

  async checkEmailUsername(params: { username?: string; email: string }) {
    const { username, email } = params
    const userAvailable = await this.userRepository.find({
      where: {
        OR: [{ email: email }, { username: username }],
      },
      select: { email: true, username: true },
    })

    if (email && userAvailable?.email === email) {
      throw new ConflictException(
        exceptions.USER.EMAIL_ALREADY_REGISTERED(email),
      )
    } else if (username && userAvailable?.username === username) {
      throw new ConflictException(
        exceptions.USER.USERNAME_ALREADY_REGISTERED(username),
      )
    }
  }

  async activate(id: string) {
    return await this.userRepository.update({
      where: { id },
      data: { activated: true },
    })
  }

  async editUser(params: {
    id: string
    updateUserDto: UpdateUserDto
    oldUser?: UserEntity
    image?: Express.Multer.File
  }) {
    const { id, updateUserDto, oldUser, image } = params

    const usernameOrEmailChanged =
      oldUser &&
      ((updateUserDto.username &&
        updateUserDto.username !== oldUser.username) ||
        (updateUserDto.email && updateUserDto.email !== oldUser.email))

    if (!oldUser || usernameOrEmailChanged) {
      await this.checkEmailUsername({
        email: updateUserDto.email,
        username: updateUserDto.username,
      })
    }

    const filename = image
      ? await this.storageService.generateRandomFilename(image.originalname)
      : undefined

    const { deleteImage, ...data } = updateUserDto

    try {
      const user = await this.userRepository.update({
        where: { id },
        data: {
          ...data,
          image: filename ? filename : deleteImage ? null : filename,
          balance:
            updateUserDto instanceof AdminUpdateUserDto
              ? {
                  update: {
                    where: { userId: id },
                    data: {
                      balance: updateUserDto.balance,
                      revenue: updateUserDto.revenue,
                    },
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
      // delete old image if `deleteImage` is true or if there's new `filename`
      if ((deleteImage || filename) && oldUser.image) {
        try {
          this.storageService.deleteFile(
            config.storage.userImagePath,
            oldUser.image,
          )
        } catch (e) {
          console.error(e)
        }
      }

      const newAuth = usernameOrEmailChanged
        ? await this.authService.login(user)
        : undefined

      return { user: new UserEntity(user), newAuth }
    } catch (e) {
      console.error(e)

      if (filename)
        this.storageService.deleteFile(config.storage.userImagePath, filename)
      throw new InternalServerErrorException(e)
    }
  }
}
