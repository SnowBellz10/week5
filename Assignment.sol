// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ข้อ 1: เก็บชื่อและคะแนน เชื่อมกับ address ของนักศึกษา
contract StudentScores {
    address public teacher;

    struct Student {
        string name;
        uint256 score;
        bool exists;
    }

    mapping(address => Student) public students;

    constructor() {
        teacher = msg.sender;
    }

    function setStudent(
        address studentAddress,
        string memory name,
        uint256 score
    ) public {
        require(msg.sender == teacher, "Only teacher");
        require(studentAddress != address(0), "Invalid address");
        require(score <= 100, "Score must be 0-100");

        students[studentAddress] = Student(name, score, true);
    }

    function getStudent(address studentAddress)
        public
        view
        returns (string memory name, uint256 score)
    {
        require(students[studentAddress].exists, "Student not found");

        Student storage student = students[studentAddress];
        return (student.name, student.score);
    }
}

// ข้อ 2: เพิ่มสินค้า พร้อมชื่อ ราคา และจำนวนคงเหลือ
contract ProductInventory {
    address public owner;
    uint256 public productCount;

    struct Product {
        string name;
        uint256 price; // หน่วย wei
        uint256 stock;
        bool exists;
    }

    mapping(uint256 => Product) public products;

    constructor() {
        owner = msg.sender;
    }

    function addProduct(
        string memory name,
        uint256 price,
        uint256 stock
    ) public returns (uint256 productId) {
        require(msg.sender == owner, "Only owner");
        require(bytes(name).length > 0, "Name is required");

        productId = ++productCount;
        products[productId] = Product(name, price, stock, true);
    }

    function getProduct(uint256 productId)
        public
        view
        returns (string memory name, uint256 price, uint256 stock)
    {
        require(products[productId].exists, "Product not found");

        Product storage product = products[productId];
        return (product.name, product.price, product.stock);
    }
}

// ข้อ 3: ซื้อตั๋วคอนเสิร์ต และตรวจสอบตั๋วของตนเอง
contract ConcertTickets {
    address payable public organizer;
    uint256 public ticketPrice;
    uint256 public totalTickets;
    uint256 public soldTickets;

    struct Ticket {
        uint256 ticketId;
        bool purchased;
    }

    mapping(address => Ticket) public tickets;

    constructor(uint256 priceInWei, uint256 capacity) {
        require(priceInWei > 0, "Price must be positive");
        require(capacity > 0, "Capacity must be positive");

        organizer = payable(msg.sender);
        ticketPrice = priceInWei;
        totalTickets = capacity;
    }

    function buyTicket() public payable {
        require(!tickets[msg.sender].purchased, "Already purchased");
        require(soldTickets < totalTickets, "Sold out");
        require(msg.value == ticketPrice, "Incorrect payment");

        soldTickets++;
        tickets[msg.sender] = Ticket(soldTickets, true);
    }

    function checkMyTicket()
        public
        view
        returns (uint256 ticketId, bool purchased)
    {
        Ticket storage ticket = tickets[msg.sender];
        return (ticket.ticketId, ticket.purchased);
    }

    function withdraw() public {
        require(msg.sender == organizer, "Only organizer");

        (bool success, ) = organizer.call{
            value: address(this).balance
        }("");
        require(success, "Transfer failed");
    }
}