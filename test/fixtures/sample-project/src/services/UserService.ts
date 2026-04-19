export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

export class UserService {
  private users: User[] = [
    { id: 1, firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
    { id: 2, firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
  ];

  async getAll(): Promise<User[]> {
    return this.users;
  }

  async getById(id: number): Promise<User | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async create(user: Omit<User, 'id'>): Promise<User> {
    const newUser: User = { id: this.users.length + 1, ...user };
    this.users.push(newUser);
    return newUser;
  }
}
