import { formatName } from './utils';
import { UserService } from './services/UserService';

const service = new UserService();

async function run() {
  const users = await service.getAll();
  for (const user of users) {
    console.log(formatName(user.firstName, user.lastName));
  }
}

run().catch(console.error);
