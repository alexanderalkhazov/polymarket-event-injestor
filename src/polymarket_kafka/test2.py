class Person:
    def __init__(self, name: str, age: int) -> None:
        self.name = name
        self.age = age


instance: Person = Person("John", 30)
print(instance)


name: str = instance.name
age: int = instance.age
print(name)
print(age)