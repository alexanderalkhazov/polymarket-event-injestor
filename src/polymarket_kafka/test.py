"""
Python Language Reference Guide
================================
A comprehensive documentation of Python features, syntax, and patterns.
"""

# =============================================================================
# 1. BASIC SYNTAX & COMMENTS
# =============================================================================

# Single-line comment
"""Multi-line string (docstring) - often used for modules, classes, functions."""


# =============================================================================
# 2. DATA TYPES - PRIMITIVES
# =============================================================================

# Integers (unlimited size)
integer: int = 42
neg_int: int = -100

# Floats (decimal numbers)
float_num: float = 3.14
scientific: float = 1.5e-3  # 0.0015

# Booleans
true_val: bool = True
false_val: bool = False

# None (absence of value)
nothing: None = None

# Strings (immutable, single or double quotes)
single: str = "hello"
double: str = "world"
multiline: str = """
Line 1
Line 2
"""
f_string: str = f"Interpolation: {integer} + {float_num} = {integer + float_num}"
raw: str = r"C:\path\no\escape"

# Bytes (immutable sequence of bytes)
b: bytes = b"hello"
bytearray_val: bytearray = bytearray(b"mutable")


# =============================================================================
# 3. COLLECTIONS
# =============================================================================

# List (mutable, ordered)
lst: list[int] = [1, 2, 3]
lst.append(4)
lst[0] = 10

# Tuple (immutable, ordered)
tup: tuple[int, str, float] = (1, "a", 3.14)
single_elem: tuple[int, ...] = (1,)  # trailing comma for single element

# Set (mutable, unordered, unique elements)
s: set[str] = {"a", "b", "c"}
s.add("d")

# FrozenSet (immutable set)
fs: frozenset[int] = frozenset({1, 2, 3})

# Dict (mutable, key-value pairs)
d: dict[str, int] = {"a": 1, "b": 2}
d["c"] = 3


# =============================================================================
# 4. TYPE HINTS (typing module)
# =============================================================================

from typing import Any, Optional, Union, List, Dict, Tuple, Callable, TypeVar

# Optional[X] = Union[X, None]
opt: Optional[int] = None

# Union (X or Y)
union_val: Union[int, str] = "hello"

# Generic collections
list_of_str: List[str] = ["a", "b"]
dict_str_int: Dict[str, int] = {"x": 1}

# Callable (function type)
func_type: Callable[[int, str], bool]  # (int, str) -> bool

# Any (no type checking)
any_val: Any = 42

# TypeVar (generic)
T = TypeVar("T")


def identity(x: T) -> T:
    """Generic function preserving type."""
    return x


# Python 3.9+ built-in generics (no import needed)
native_list: list[int] = [1, 2, 3]
native_dict: dict[str, int] = {"a": 1}


# =============================================================================
# 5. OPERATORS
# =============================================================================

# Arithmetic: + - * / // % **
quotient: int = 7 // 3  # 2
remainder: int = 7 % 3  # 1
power: int = 2**10  # 1024

# Comparison: == != < > <= >=
# Logical: and or not
# Identity: is, is not
# Membership: in, not in

# Walrus operator (:=) - assign and use in expression
# if (n := len(lst)) > 0:
#     print(n)


# =============================================================================
# 6. CONTROL FLOW
# =============================================================================

# if / elif / else
def control_example(x: int) -> str:
    if x > 0:
        return "positive"
    elif x < 0:
        return "negative"
    else:
        return "zero"


# for loop
for item in [1, 2, 3]:
    pass  # placeholder

for i, val in enumerate(["a", "b", "c"]):
    pass  # i=0, val="a"; i=1, val="b"; ...

for k, v in {"a": 1, "b": 2}.items():
    pass

# while loop
n = 0
while n < 5:
    n += 1

# break, continue
for i in range(10):
    if i == 3:
        continue
    if i == 7:
        break


# =============================================================================
# 7. FUNCTIONS
# =============================================================================

def simple(a: int, b: int) -> int:
    """Docstring describes the function."""
    return a + b


def with_defaults(a: int = 1, b: int = 2) -> int:
    return a + b


def args_kwargs(*args: int, **kwargs: str) -> None:
    """*args: positional tuple, **kwargs: keyword dict."""
    print(args)   # (1, 2, 3)
    print(kwargs)  # {"x": "a"}


# Keyword-only args (after *)
def keyword_only(*, required: int) -> None:
    pass


# Positional-only args (before /)
def positional_only(a: int, b: int, /) -> int:
    return a + b


# Lambda (anonymous function)
square = lambda x: x**2


# =============================================================================
# 8. COMPREHENSIONS
# =============================================================================

# List comprehension
squares: list[int] = [x**2 for x in range(5)]  # [0, 1, 4, 9, 16]
filtered: list[int] = [x for x in range(10) if x % 2 == 0]

# Dict comprehension
square_map: dict[int, int] = {x: x**2 for x in range(5)}

# Set comprehension
unique_lengths: set[int] = {len(s) for s in ["a", "ab", "a"]}  # {1, 2}

# Generator expression (lazy)
gen = (x**2 for x in range(1000000))


# =============================================================================
# 9. CLASSES & OOP
# =============================================================================

class Person:
    """Class docstring."""

    # Class attribute (shared)
    species: str = "Homo sapiens"

    def __init__(self, name: str, age: int) -> None:
        """Constructor."""
        self.name = name  # instance attribute
        self.age = age

    def greet(self) -> str:
        """Instance method."""
        return f"Hello, I'm {self.name}"

    @classmethod
    def from_birth_year(cls, name: str, birth_year: int) -> "Person":
        """Class method - receives cls."""
        return cls(name, 2025 - birth_year)

    @staticmethod
    def is_adult(age: int) -> bool:
        """Static method - no self/cls."""
        return age >= 18

    def __str__(self) -> str:
        """String representation."""
        return f"Person({self.name}, {self.age})"

    def __repr__(self) -> str:
        """Developer representation."""
        return f"Person(name={self.name!r}, age={self.age})"


# Inheritance
class Employee(Person):
    def __init__(self, name: str, age: int, salary: float) -> None:
        super().__init__(name, age)  # call parent __init__
        self.salary = salary


# Property (getter/setter)
class Rectangle:
    def __init__(self, width: float, height: float) -> None:
        self._width = width
        self._height = height

    @property
    def area(self) -> float:
        return self._width * self._height

    @property
    def width(self) -> float:
        return self._width

    @width.setter
    def width(self, value: float) -> None:
        if value <= 0:
            raise ValueError("Width must be positive")
        self._width = value


# =============================================================================
# 10. DATACLASSES
# =============================================================================

from dataclasses import dataclass, field


@dataclass
class Point:
    x: float
    y: float
    z: float = 0.0  # default


@dataclass(frozen=True)
class ImmutablePoint:
    """Frozen = immutable after creation."""
    x: float
    y: float


@dataclass
class WithDefaults:
    name: str = "unnamed"
    items: list[str] = field(default_factory=list)  # mutable default


# =============================================================================
# 11. PYDANTIC MODELS (validation)
# =============================================================================

from pydantic import BaseModel, Field


class User(BaseModel):
    id: int
    name: str = "anonymous"
    email: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=10)

    model_config = {"extra": "forbid"}  # reject unknown fields
    # model_config = {"frozen": True}  # immutable


# =============================================================================
# 12. ENUMS
# =============================================================================

from enum import Enum, auto


class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 3


class AutoEnum(Enum):
    A = auto()  # 1
    B = auto()  # 2


class StrEnum(str, Enum):
    """String enum - values are strings."""
    YES = "yes"
    NO = "no"


# =============================================================================
# 13. ERROR HANDLING
# =============================================================================

def error_example() -> None:
    try:
        result = 1 / 0
    except ZeroDivisionError as e:
        print(f"Caught: {e}")
    except (ValueError, TypeError) as e:
        print(f"Multiple: {e}")
    except Exception as e:
        print(f"Any: {e}")
    else:
        print("No exception")
    finally:
        print("Always runs")

    # raise
    raise ValueError("Custom error")


# Context manager (with)
# with open("file.txt") as f:
#     content = f.read()


# =============================================================================
# 14. CONTEXT MANAGERS
# =============================================================================

from contextlib import contextmanager


@contextmanager
def managed_resource():
    """Custom context manager."""
    print("enter")
    try:
        yield "resource"
    finally:
        print("exit")


# with managed_resource() as r:
#     print(r)


# =============================================================================
# 15. DECORATORS
# =============================================================================

from functools import wraps


def my_decorator(func: Callable) -> Callable:
    @wraps(func)  # preserve __name__, __doc__
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        print("Before")
        result = func(*args, **kwargs)
        print("After")
        return result

    return wrapper


@my_decorator
def decorated_func(x: int) -> int:
    return x * 2


# =============================================================================
# 16. ASYNC / AWAIT
# =============================================================================

import asyncio


async def async_func() -> str:
    await asyncio.sleep(1)
    return "done"


async def main_async() -> None:
    result = await async_func()
    tasks = [async_func() for _ in range(3)]
    results = await asyncio.gather(*tasks)


# asyncio.run(main_async())


# =============================================================================
# 17. ITERATORS & GENERATORS
# =============================================================================

def generator() -> Any:
    yield 1
    yield 2
    yield 3


# for x in generator():
#     print(x)


class MyIterator:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.n = 0

    def __iter__(self) -> "MyIterator":
        return self

    def __next__(self) -> int:
        if self.n >= self.limit:
            raise StopIteration
        self.n += 1
        return self.n


# =============================================================================
# 18. MODULES & IMPORTS
# =============================================================================

# import module
# import module as alias
# from module import name
# from module import name as alias
# from module import *
# from . import sibling  # relative (package)

# __all__ = ["public1", "public2"]  # controls "from module import *"


# =============================================================================
# 19. STRUCTURAL PATTERN MATCHING (match/case, Python 3.10+)
# =============================================================================

def match_example(value: Any) -> str:
    match value:
        case 0:
            return "zero"
        case 1 | 2:
            return "one or two"
        case [x, y]:
            return f"pair: {x}, {y}"
        case {"name": str(n)}:
            return f"name is {n}"
        case _:
            return "default"


# =============================================================================
# 20. WALRUS OPERATOR (:=)
# =============================================================================

# Assign and use in same expression
# if (n := len(data)) > 10:
#     print(f"Too long: {n}")
# while (line := file.readline()):
#     process(line)


# =============================================================================
# 21. SLICING
# =============================================================================

arr = [0, 1, 2, 3, 4, 5]
arr[1:4]   # [1, 2, 3]  start:stop
arr[::2]   # [0, 2, 4]  step
arr[::-1]  # [5, 4, 3, 2, 1, 0]  reverse


# =============================================================================
# 22. SPECIAL METHODS (DUNDER)
# =============================================================================

# __init__, __str__, __repr__
# __len__, __getitem__, __setitem__, __delitem__
# __iter__, __next__
# __enter__, __exit__  (context manager)
# __add__, __eq__, __lt__, etc.  (operators)
# __call__  (callable object)
# __getattr__, __setattr__
# __slots__  (memory optimization)